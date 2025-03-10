require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;
app.use(bodyParser.json(), cors());

// 📌 Banco de Dados SQLite
const db = new sqlite3.Database('./auth_logs.db', err => {
    if (err) console.error('❌ Erro BD:', err);
    else console.log('✅ BD Conectado.');
});
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS login_logs (id INTEGER PRIMARY KEY, email TEXT, login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, success INTEGER, ip TEXT, otp_code TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS user_tokens (email TEXT PRIMARY KEY, accessToken TEXT, idToken TEXT, refreshToken TEXT, expiresAt INTEGER)`);
});

// 📌 Pools de usuários (Usuário Comum e Administrador)
const userPool = new AmazonCognitoIdentity.CognitoUserPool({ UserPoolId: process.env.COGNITO_USER_POOL_ID, ClientId: process.env.COGNITO_CLIENT_ID });
const adminPool = new AmazonCognitoIdentity.CognitoUserPool({ UserPoolId: process.env.COGNITO_USER_POOL_ID_ADMIN, ClientId: process.env.COGNITO_CLIENT_ID_ADMIN });

// 📌 Funções de banco de dados
const executeQuery = (query, params = [], callback) => {
    db.run(query, params, err => {
        if (err) console.error(`❌ Erro BD: ${query}`, err);
        if (callback) callback(err);
    });
};

const fetchOne = (query, params = [], callback) => {
    db.get(query, params, (err, row) => {
        if (err) console.error(`❌ Erro BD Fetch: ${query}`, err);
        callback(row);
    });
};

// 📌 Funções auxiliares
const saveLog = (email, success, ip, otp = null) => executeQuery(`INSERT INTO login_logs (email, success, ip, otp_code) VALUES (?, ?, ?, ?)`, [email, success ? 1 : 0, ip, otp]);
const saveTokens = (email, accessToken, idToken, refreshToken, expiresIn) => {
    if (!accessToken || !idToken || !refreshToken) {
        console.error(`❌ Erro ao salvar tokens: Dados inválidos para ${email}`);
        return;
    }
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    executeQuery(`INSERT INTO user_tokens (email, accessToken, idToken, refreshToken, expiresAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET accessToken = excluded.accessToken, idToken = excluded.idToken, refreshToken = excluded.refreshToken, expiresAt = excluded.expiresAt`, 
        [email, accessToken, idToken, refreshToken, expiresAt]);
};

const getTokens = (email, callback) => fetchOne(`SELECT * FROM user_tokens WHERE email = ?`, [email], callback);
const isTokenValid = token => {
    try {
        const decoded = jwt.decode(token);
        return decoded && decoded.exp > Math.floor(Date.now() / 1000) + 60;
    } catch { return false; }
};

// 📌 Renova Tokens Cognito
const refreshTokens = (email, refreshToken, res, retryLogin, password, otp, req, isAdmin) => {
    if (!refreshToken) {
        console.warn(`⚠️ Nenhum refresh token para ${email}. Fazendo login novamente.`);
        return authenticate(email, password, otp, req, res, isAdmin);
    }

    const pool = isAdmin ? adminPool : userPool;
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: pool });

    try {
        cognitoUser.refreshSession(new AmazonCognitoIdentity.CognitoRefreshToken({ Token: refreshToken }), (err, session) => {
            if (err) {
                console.error('❌ Erro ao renovar token:', err);
                return retryLogin ? authenticate(email, password, otp, req, res, isAdmin) : res.status(401).json({ success: false, error: 'Refresh token expirado. Faça login novamente.' });
            }
            saveTokens(email, session.getAccessToken().getJwtToken(), session.getIdToken().getJwtToken(), refreshToken, session.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));
            res.json({ success: true, accessToken: session.getAccessToken().getJwtToken(), idToken: session.getIdToken().getJwtToken(), refreshToken });
        });
    } catch (error) {
        console.error('❌ Exceção ao renovar token:', error);
        res.status(500).json({ success: false, error: 'Erro interno ao renovar token' });
    }
};

// 📌 Autenticação Cognito com MFA
const authenticate = (email, password, otp, req, res, isAdmin = false) => {
    const pool = isAdmin ? adminPool : userPool;
    const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: pool });
    const userIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    try {
        cognitoUser.authenticateUser(authDetails, {
            onSuccess: result => {
                saveLog(email, true, userIP, otp);
                saveTokens(email, result.getAccessToken().getJwtToken(), result.getIdToken().getJwtToken(), result.getRefreshToken().getToken(), result.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));
                res.json({ success: true, accessToken: result.getAccessToken().getJwtToken(), idToken: result.getIdToken().getJwtToken(), refreshToken: result.getRefreshToken().getToken() });
            },
            onFailure: err => {
                console.error('❌ Erro na autenticação:', err);
                res.status(401).json({ success: false, error: err.message || 'Falha na autenticação' });
            },
            totpRequired: () => {
                if (!otp) return res.status(401).json({ success: false, error: 'Código TOTP obrigatório.' });
                cognitoUser.sendMFACode(otp, {
                    onSuccess: result => {
                        saveTokens(email, result.getAccessToken().getJwtToken(), result.getIdToken().getJwtToken(), result.getRefreshToken().getToken(), result.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));
                        res.json({ success: true, accessToken: result.getAccessToken().getJwtToken(), idToken: result.getIdToken().getJwtToken(), refreshToken: result.getRefreshToken().getToken() });
                    },
                    onFailure: err => {
                        console.error('❌ Erro no MFA:', err);
                        res.status(401).json({ success: false, error: err.message || 'Erro ao validar MFA.' });
                    }
                }, 'SOFTWARE_TOKEN_MFA');
            }
        });
    } catch (error) {
        console.error('❌ Exceção na autenticação:', error);
        res.status(500).json({ success: false, error: 'Erro interno na autenticação' });
    }
};

// 📌 Rota de autenticação
const handleAuth = (req, res, isAdmin = false) => {
    const { email, password, otp } = req.body;
    getTokens(email, tokens => {
        if (tokens && isTokenValid(tokens.accessToken)) return res.json(tokens);
        refreshTokens(email, tokens ? tokens.refreshToken : null, res, true, password, otp, req, isAdmin);
    });
};

app.post('/auth', (req, res) => handleAuth(req, res, false));
app.post('/admin/auth', (req, res) => handleAuth(req, res, true));

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`));
