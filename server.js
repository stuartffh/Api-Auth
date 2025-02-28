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
const db = new sqlite3.Database('./auth_logs.db', err => err ? console.error('Erro BD:', err) : console.log('✅ BD Conectado.'));
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS login_logs (id INTEGER PRIMARY KEY, email TEXT, login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, success INTEGER, ip TEXT, otp_code TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS user_tokens (email TEXT PRIMARY KEY, accessToken TEXT, idToken TEXT, refreshToken TEXT, expiresAt INTEGER)`);
});

const userPool = new AmazonCognitoIdentity.CognitoUserPool({ UserPoolId: process.env.COGNITO_USER_POOL_ID, ClientId: process.env.COGNITO_CLIENT_ID });
const adminPool = new AmazonCognitoIdentity.CognitoUserPool({ UserPoolId: process.env.COGNITO_USER_POOL_ID_ADMIN, ClientId: process.env.COGNITO_CLIENT_ID_ADMIN });

const saveLog = (email, success, ip, otp = null) => db.run(`INSERT INTO login_logs (email, success, ip, otp_code) VALUES (?, ?, ?, ?)`, [email, success ? 1 : 0, ip, otp]);
const saveTokens = (email, accessToken, idToken, refreshToken, expiresIn) => {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    db.run(`INSERT INTO user_tokens (email, accessToken, idToken, refreshToken, expiresAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET accessToken = excluded.accessToken, idToken = excluded.idToken, refreshToken = excluded.refreshToken, expiresAt = excluded.expiresAt`, 
        [email, accessToken, idToken, refreshToken, expiresAt]);
};
const getTokens = (email, callback) => db.get(`SELECT * FROM user_tokens WHERE email = ?`, [email], (err, row) => callback(err ? null : row));
const isTokenValid = token => {
    try {
        const decoded = jwt.decode(token);
        return decoded && decoded.exp > Math.floor(Date.now() / 1000) + 60;
    } catch { return false; }
};

const refreshTokens = (email, refreshToken, res, retryLogin, password, otp, req, isAdmin) => {
    if (!refreshToken) {
        console.warn(`⚠️ Nenhum refresh token encontrado para ${email}. Fazendo login novamente.`);
        return authenticate(email, password, otp, req, res, isAdmin); // Faz login novamente
    }

    const pool = isAdmin ? adminPool : userPool;
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: pool });

    cognitoUser.refreshSession(new AmazonCognitoIdentity.CognitoRefreshToken({ Token: refreshToken }), (err, session) => {
        if (err) {
            console.error('Erro ao renovar token:', err);
            return retryLogin ? authenticate(email, password, otp, req, res, isAdmin) : res.status(401).json({ success: false, error: 'Refresh token expirado. Faça login novamente.' });
        }
        saveTokens(email, session.getAccessToken().getJwtToken(), session.getIdToken().getJwtToken(), refreshToken, session.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));
        res.json({ success: true, accessToken: session.getAccessToken().getJwtToken(), idToken: session.getIdToken().getJwtToken(), refreshToken });
    });
};

const authenticate = (email, password, otp, req, res, isAdmin = false) => {
    const pool = isAdmin ? adminPool : userPool;
    const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: pool });
    const userIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    cognitoUser.authenticateUser(authDetails, {
        onSuccess: result => {
            saveLog(email, true, userIP, otp);
            saveTokens(email, result.getAccessToken().getJwtToken(), result.getIdToken().getJwtToken(), result.getRefreshToken().getToken(), result.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));
            res.json({ success: true, accessToken: result.getAccessToken().getJwtToken(), idToken: result.getIdToken().getJwtToken(), refreshToken: result.getRefreshToken().getToken() });
        },
        onFailure: err => res.status(401).json({ success: false, error: err.message || 'Falha na autenticação' }),
        totpRequired: () => {
            if (!otp) return res.status(401).json({ success: false, error: 'Código TOTP obrigatório.' });
            cognitoUser.sendMFACode(otp, {
                onSuccess: result => {
                    saveTokens(email, result.getAccessToken().getJwtToken(), result.getIdToken().getJwtToken(), result.getRefreshToken().getToken(), result.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));
                    res.json({ success: true, accessToken: result.getAccessToken().getJwtToken(), idToken: result.getIdToken().getJwtToken(), refreshToken: result.getRefreshToken().getToken() });
                },
                onFailure: err => res.status(401).json({ success: false, error: err.message || 'Erro ao validar MFA.' })
            }, 'SOFTWARE_TOKEN_MFA');
        }
    });
};

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
