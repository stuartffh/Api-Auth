const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const logger = require('../utils/logger');

class CognitoConfig {
    constructor() {
        this.userPool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            ClientId: process.env.COGNITO_CLIENT_ID
        });

        this.adminPool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: process.env.COGNITO_USER_POOL_ID_ADMIN,
            ClientId: process.env.COGNITO_CLIENT_ID_ADMIN
        });

        logger.info('Pools Cognito configurados', {
            userPoolId: process.env.COGNITO_USER_POOL_ID ? 'configurado' : 'não configurado',
            adminPoolId: process.env.COGNITO_USER_POOL_ID_ADMIN ? 'configurado' : 'não configurado'
        });
    }

    getPool(isAdmin = false) {
        return isAdmin ? this.adminPool : this.userPool;
    }

    createCognitoUser(email, isAdmin = false) {
        const pool = this.getPool(isAdmin);
        return new AmazonCognitoIdentity.CognitoUser({
            Username: email,
            Pool: pool
        });
    }

    createAuthenticationDetails(email, password) {
        return new AmazonCognitoIdentity.AuthenticationDetails({
            Username: email,
            Password: password
        });
    }

    createRefreshToken(token) {
        return new AmazonCognitoIdentity.CognitoRefreshToken({ Token: token });
    }
}

module.exports = new CognitoConfig();

