require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;

// 📌 Conexão com Banco de Dados SQLite
const db = new sqlite3.Database('./auth_logs.db', (err) => {
    if (err) console.error('Erro ao conectar ao banco de dados', err);
    else console.log('✅ Banco de dados SQLite conectado.');
});

// 🔹 Criação das tabelas no banco de dados
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            success INTEGER NOT NULL,
            ip TEXT,
            otp_code TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS user_tokens (
            email TEXT PRIMARY KEY,
            accessToken TEXT,
            idToken TEXT,
            refreshToken TEXT,
            expiresAt INTEGER
        )
    `);
});

// 🔹 Middleware
app.use(bodyParser.json());
app.use(cors());

// 🔹 Configuração dos pools de usuários (Usuário comum e Administrador)
const userPool = new AmazonCognitoIdentity.CognitoUserPool({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    ClientId: process.env.COGNITO_CLIENT_ID
});

const adminPool = new AmazonCognitoIdentity.CognitoUserPool({
    UserPoolId: process.env.COGNITO_USER_POOL_ID_ADMIN,
    ClientId: process.env.COGNITO_CLIENT_ID_ADMIN
});

// 🔹 Função para salvar logs de login
function saveLoginLog(email, success, ip, otp = null) {
    db.run(`
        INSERT INTO login_logs (email, success, ip, otp_code)
        VALUES (?, ?, ?, ?)`, 
        [email, success ? 1 : 0, ip, otp], 
        (err) => {
            if (err) console.error('Erro ao salvar log de login:', err);
        }
    );
}

// 🔹 Salvar ou atualizar tokens no banco de dados
function saveTokens(email, accessToken, idToken, refreshToken, expiresIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    db.run(`
        INSERT INTO user_tokens (email, accessToken, idToken, refreshToken, expiresAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET accessToken = excluded.accessToken, idToken = excluded.idToken, refreshToken = excluded.refreshToken, expiresAt = excluded.expiresAt`,
        [email, accessToken, idToken, refreshToken, expiresAt], 
        (err) => {
            if (err) console.error('Erro ao salvar tokens:', err);
        }
    );
}

// 🔹 Função para buscar tokens do banco
function getStoredTokens(email, callback) {
    db.get(`SELECT * FROM user_tokens WHERE email = ?`, [email], (err, row) => {
        if (err) {
            console.error('Erro ao buscar tokens:', err);
            return callback(null);
        }
        callback(row);
    });
}

// 🔹 Função para validar token JWT
function isTokenValid(token) {
    try {
        const decoded = jwt.decode(token);
        return decoded && decoded.exp > Math.floor(Date.now() / 1000) + 60; // Expira em menos de 1 minuto?
    } catch (error) {
        return false;
    }
}

// 🔹 Função para renovar tokens usando o refreshToken
function refreshTokens(email, refreshToken, res) {
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
        Username: email,
        Pool: userPool
    });

    cognitoUser.refreshSession(new AmazonCognitoIdentity.CognitoRefreshToken({ Token: refreshToken }), (err, session) => {
        if (err) {
            console.error('Erro ao renovar token:', err);
            return res.status(401).json({ success: false, error: 'Refresh token expirado. Faça login novamente.' });
        }

        // Salvar novo token no banco
        saveTokens(email, session.getAccessToken().getJwtToken(), session.getIdToken().getJwtToken(), refreshToken, session.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));

        res.json({
            success: true,
            accessToken: session.getAccessToken().getJwtToken(),
            idToken: session.getIdToken().getJwtToken(),
            refreshToken: refreshToken
        });
    });
}

// 🔹 Função de autenticação com MFA
async function authenticateWithMFA(email, password, otp, req, res, isAdmin = false) {
    const pool = isAdmin ? adminPool : userPool;

    const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: email,
        Password: password
    });

    const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
        Username: email,
        Pool: pool
    });

    const userIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: function (result) {
            saveLoginLog(email, true, userIP, otp);

            saveTokens(email, result.getAccessToken().getJwtToken(), result.getIdToken().getJwtToken(), result.getRefreshToken().getToken(), result.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));

            res.json({
                success: true,
                accessToken: result.getAccessToken().getJwtToken(),
                idToken: result.getIdToken().getJwtToken(),
                refreshToken: result.getRefreshToken().getToken()
            });
        },

        onFailure: function (err) {
            saveLoginLog(email, false, userIP);
            res.status(401).json({ success: false, error: err.message || 'Falha na autenticação' });
        },

        totpRequired: function () {
            if (!otp) {
                return res.status(401).json({ success: false, error: 'Código TOTP obrigatório. Envie o código OTP.' });
            }

            cognitoUser.sendMFACode(otp, {
                onSuccess: function (result) {
                    saveTokens(email, result.getAccessToken().getJwtToken(), result.getIdToken().getJwtToken(), result.getRefreshToken().getToken(), result.getAccessToken().getExpiration() - Math.floor(Date.now() / 1000));
                    
                    res.json({
                        success: true,
                        accessToken: result.getAccessToken().getJwtToken(),
                        idToken: result.getIdToken().getJwtToken(),
                        refreshToken: result.getRefreshToken().getToken()
                    });
                },
                onFailure: function (err) {
                    res.status(401).json({ success: false, error: err.message || 'Erro ao validar MFA.' });
                }
            }, 'SOFTWARE_TOKEN_MFA');
        }
    });
}

// 🔹 Rota de autenticação (Usuário Comum)
app.post('/auth', async (req, res) => {
    const { email, password, otp } = req.body;

    getStoredTokens(email, (tokens) => {
        if (tokens && isTokenValid(tokens.accessToken)) {
            return res.json({
                success: true,
                accessToken: tokens.accessToken,
                idToken: tokens.idToken,
                refreshToken: tokens.refreshToken
            });
        }

        if (tokens && tokens.refreshToken) {
            return refreshTokens(email, tokens.refreshToken, res);
        }

        authenticateWithMFA(email, password, otp, req, res);
    });
});

// 🔹 Rota de autenticação (Administrador)
app.post('/admin/auth', async (req, res) => {
    const { email, password, otp } = req.body;

    getStoredTokens(email, (tokens) => {
        if (tokens && isTokenValid(tokens.accessToken)) {
            return res.json({
                success: true,
                accessToken: tokens.accessToken,
                idToken: tokens.idToken,
                refreshToken: tokens.refreshToken
            });
        }

        if (tokens && tokens.refreshToken) {
            return refreshTokens(email, tokens.refreshToken, res);
        }

        authenticateWithMFA(email, password, otp, req, res, true);
    });
});

// 🔹 Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`);
});
