require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');

const app = express();
const PORT = process.env.PORT || 4000;

// Configuração do Express
app.use(bodyParser.json());
app.use(cors());

const poolData = {
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    ClientId: process.env.COGNITO_CLIENT_ID
};

const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

// Função para autenticação com TOTP (MFA obrigatório)
async function authenticateWithMFA(email, password, otp, res) {
    const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: email,
        Password: password
    });

    const userData = {
        Username: email,
        Pool: userPool
    };

    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: function (result) {
            res.json({
                success: true,
                accessToken: result.getAccessToken().getJwtToken(),
                idToken: result.getIdToken().getJwtToken(),
                refreshToken: result.getRefreshToken().getToken()
            });
        },

        onFailure: function (err) {
            res.status(401).json({ success: false, error: err.message || 'Falha na autenticação' });
        },

        // MFA obrigatório via TOTP (Google Authenticator, Authy, etc.)
        totpRequired: function () {
            if (!otp) {
                return res.status(401).json({ success: false, error: 'Código TOTP obrigatório. Envie o código OTP.' });
            }

            cognitoUser.sendMFACode(otp, {
                onSuccess: function (result) {
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

// Rota de autenticação
app.post('/auth', async (req, res) => {
    const { email, password, otp } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios.' });
    }

    authenticateWithMFA(email, password, otp, res);
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
