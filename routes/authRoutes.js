const express = require('express');
const AuthService = require('../services/authService');
const TokenService = require('../services/tokenService');
const { validateAuthInput } = require('../middleware/validation');
const RateLimiter = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

const createAuthRoutes = (database) => {
    const router = express.Router();
    const tokenService = new TokenService(database);
    const authService = new AuthService(database, tokenService);
    const rateLimiter = new RateLimiter(5, 60000); // 5 tentativas por minuto

    const createAuthHandler = (isAdmin) => {
        return async (req, res, next) => {
            try {
                const { email, password, otp } = req.body;
                
                const result = await authService.handleAuth(email, password, otp, req, isAdmin);
                
                // Reset rate limiter em caso de sucesso
                const clientIP = authService.getClientIP(req);
                rateLimiter.reset(clientIP);
                
                res.json(result);
            } catch (error) {
                next(error);
            }
        };
    };

    // Rota de autenticação para usuários comuns
    router.post('/auth', 
        rateLimiter.middleware(),
        validateAuthInput,
        createAuthHandler(false)
    );

    // Rota de autenticação para administradores
    router.post('/admin/auth',
        rateLimiter.middleware(),
        validateAuthInput,
        createAuthHandler(true)
    );

    return router;
};

module.exports = createAuthRoutes;

