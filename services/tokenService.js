const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class TokenService {
    constructor(database) {
        this.db = database;
    }

    async saveTokens(email, accessToken, idToken, refreshToken, expiresIn, accountancyToken = null) {
        const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
        await this.db.saveTokens(email, accessToken, idToken, refreshToken, expiresAt, accountancyToken);
    }

    async getTokens(email) {
        return await this.db.getTokens(email);
    }

    isTokenValid(token) {
        if (!token) return false;
        
        try {
            const decoded = jwt.decode(token);
            if (!decoded) return false;
            
            // Verifica se o token expira em mais de 60 segundos
            const now = Math.floor(Date.now() / 1000);
            return decoded.exp && decoded.exp > now + 60;
        } catch (error) {
            logger.warn('Erro ao decodificar token', { error: error.message });
            return false;
        }
    }

    extractTokenData(accessToken, idToken, refreshToken) {
        return {
            accessToken: accessToken.getJwtToken(),
            idToken: idToken.getJwtToken(),
            refreshToken: refreshToken.getToken(),
            expiresIn: accessToken.getExpiration() - Math.floor(Date.now() / 1000)
        };
    }
}

module.exports = TokenService;

