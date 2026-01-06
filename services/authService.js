const cognitoConfig = require('../config/cognito');
const logger = require('../utils/logger');
const ContaAzulService = require('./contaAzulService');

class AuthService {
    constructor(database, tokenService) {
        this.db = database;
        this.tokenService = tokenService;
        this.contaAzulService = new ContaAzulService();
    }

    getClientIP(req) {
        return req.ip || 
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
               req.connection.remoteAddress || 
               'unknown';
    }

    async authenticate(email, password, otp, req, isAdmin = false) {
        const userIP = this.getClientIP(req);
        const pool = cognitoConfig.getPool(isAdmin);
        const authDetails = cognitoConfig.createAuthenticationDetails(email, password);
        const cognitoUser = cognitoConfig.createCognitoUser(email, isAdmin);

        return new Promise((resolve, reject) => {
            cognitoUser.authenticateUser(authDetails, {
                onSuccess: async (result) => {
                    try {
                        await this.db.saveLog(email, true, userIP, otp);
                        const tokenData = this.tokenService.extractTokenData(
                            result.getAccessToken(),
                            result.getIdToken(),
                            result.getRefreshToken()
                        );
                        
                        // Obtém o accountancy-token do Conta Azul
                        let accountancyToken = null;
                        try {
                            accountancyToken = await this.contaAzulService.getAccountancyToken(email, password);
                        } catch (accountancyError) {
                            // Não falha a autenticação se o accountancy-token falhar
                            logger.warn('Falha ao obter accountancy-token, continuando autenticação', {
                                email: logger.maskEmail(email),
                                error: accountancyError.message
                            });
                        }
                        
                        await this.tokenService.saveTokens(
                            email,
                            tokenData.accessToken,
                            tokenData.idToken,
                            tokenData.refreshToken,
                            tokenData.expiresIn,
                            accountancyToken
                        );
                        
                        logger.info('Autenticação bem-sucedida', {
                            email: logger.maskEmail(email),
                            isAdmin,
                            ip: userIP,
                            hasAccountancyToken: !!accountancyToken
                        });

                        resolve({
                            success: true,
                            accessToken: tokenData.accessToken,
                            idToken: tokenData.idToken,
                            refreshToken: tokenData.refreshToken,
                            accountancyToken: accountancyToken
                        });
                    } catch (error) {
                        logger.error('Erro ao processar autenticação bem-sucedida', error, {
                            email: logger.maskEmail(email)
                        });
                        reject(error);
                    }
                },
                onFailure: async (err) => {
                    try {
                        await this.db.saveLog(email, false, userIP, otp);
                        logger.warn('Falha na autenticação', {
                            email: logger.maskEmail(email),
                            error: err.message,
                            ip: userIP
                        });
                    } catch (logError) {
                        logger.error('Erro ao salvar log de falha', logError);
                    }
                    const authError = new Error(err.message || 'Falha na autenticação');
                    authError.status = 401;
                    authError.name = 'AuthenticationError';
                    reject(authError);
                },
                totpRequired: () => {
            if (!otp) {
                const error = new Error('Código TOTP obrigatório.');
                error.status = 401;
                error.name = 'TOTPRequiredError';
                logger.warn('TOTP requerido mas não fornecido', {
                    email: logger.maskEmail(email)
                });
                reject(error);
                return;
            }

                    cognitoUser.sendMFACode(otp, {
                        onSuccess: async (result) => {
                            try {
                                await this.db.saveLog(email, true, userIP, otp);
                                const tokenData = this.tokenService.extractTokenData(
                                    result.getAccessToken(),
                                    result.getIdToken(),
                                    result.getRefreshToken()
                                );
                                
                                // Obtém o accountancy-token do Conta Azul
                                let accountancyToken = null;
                                try {
                                    accountancyToken = await this.contaAzulService.getAccountancyToken(email, password);
                                } catch (accountancyError) {
                                    // Não falha a autenticação se o accountancy-token falhar
                                    logger.warn('Falha ao obter accountancy-token, continuando autenticação', {
                                        email: logger.maskEmail(email),
                                        error: accountancyError.message
                                    });
                                }
                                
                                await this.tokenService.saveTokens(
                                    email,
                                    tokenData.accessToken,
                                    tokenData.idToken,
                                    tokenData.refreshToken,
                                    tokenData.expiresIn,
                                    accountancyToken
                                );

                                logger.info('Autenticação MFA bem-sucedida', {
                                    email: logger.maskEmail(email),
                                    isAdmin,
                                    ip: userIP,
                                    hasAccountancyToken: !!accountancyToken
                                });

                                resolve({
                                    success: true,
                                    accessToken: tokenData.accessToken,
                                    idToken: tokenData.idToken,
                                    refreshToken: tokenData.refreshToken,
                                    accountancyToken: accountancyToken
                                });
                            } catch (error) {
                                logger.error('Erro ao processar autenticação MFA bem-sucedida', error, {
                                    email: logger.maskEmail(email)
                                });
                                reject(error);
                            }
                        },
                        onFailure: async (err) => {
                            try {
                                await this.db.saveLog(email, false, userIP, otp);
                                logger.warn('Falha na validação MFA', {
                                    email: logger.maskEmail(email),
                                    error: err.message,
                                    ip: userIP
                                });
                            } catch (logError) {
                                logger.error('Erro ao salvar log de falha MFA', logError);
                            }
                            const mfaError = new Error(err.message || 'Erro ao validar MFA');
                            mfaError.status = 401;
                            mfaError.name = 'MFAError';
                            reject(mfaError);
                        }
                    }, 'SOFTWARE_TOKEN_MFA');
                }
            });
        });
    }

    async refreshTokens(email, refreshToken, password, otp, req, isAdmin = false) {
        if (!refreshToken) {
            logger.warn('Nenhum refresh token disponível, fazendo login novamente', {
                email: logger.maskEmail(email)
            });
            return this.authenticate(email, password, otp, req, isAdmin);
        }

        const cognitoUser = cognitoConfig.createCognitoUser(email, isAdmin);
        const refreshTokenObj = cognitoConfig.createRefreshToken(refreshToken);

        return new Promise((resolve, reject) => {
            cognitoUser.refreshSession(refreshTokenObj, async (err, session) => {
                if (err) {
                    logger.warn('Erro ao renovar token, tentando login novamente', {
                        email: logger.maskEmail(email),
                        error: err.message
                    });
                    try {
                        const result = await this.authenticate(email, password, otp, req, isAdmin);
                        resolve(result);
                    } catch (authError) {
                        const refreshError = new Error(authError.message || 'Erro ao renovar token');
                        refreshError.status = authError.status || 401;
                        refreshError.name = 'TokenRefreshError';
                        reject(refreshError);
                    }
                    return;
                }

                try {
                    const tokenData = this.tokenService.extractTokenData(
                        session.getAccessToken(),
                        session.getIdToken(),
                        session.getRefreshToken()
                    );
                    
                    // Tenta obter accountancy-token novamente ao renovar tokens
                    // Primeiro tenta recuperar do cache, se não tiver, tenta obter novo
                    const cachedTokens = await this.tokenService.getTokens(email);
                    let accountancyToken = cachedTokens?.accountancyToken || null;
                    
                    // Se não tem token em cache ou precisa renovar, tenta obter novo
                    if (!accountancyToken && password) {
                        try {
                            accountancyToken = await this.contaAzulService.getAccountancyToken(email, password);
                        } catch (accountancyError) {
                            logger.warn('Falha ao obter accountancy-token ao renovar, mantendo cache', {
                                email: logger.maskEmail(email),
                                error: accountancyError.message
                            });
                        }
                    }
                    
                    await this.tokenService.saveTokens(
                        email,
                        tokenData.accessToken,
                        tokenData.idToken,
                        refreshToken,
                        tokenData.expiresIn,
                        accountancyToken
                    );

                    logger.info('Tokens renovados com sucesso', {
                        email: logger.maskEmail(email),
                        hasAccountancyToken: !!accountancyToken
                    });

                    resolve({
                        success: true,
                        accessToken: tokenData.accessToken,
                        idToken: tokenData.idToken,
                        refreshToken: refreshToken,
                        accountancyToken: accountancyToken
                    });
                } catch (error) {
                    logger.error('Erro ao salvar tokens renovados', error, {
                        email: logger.maskEmail(email)
                    });
                    reject(error);
                }
            });
        });
    }

    async handleAuth(email, password, otp, req, isAdmin = false) {
        try {
            // Verifica se há tokens válidos em cache
            const cachedTokens = await this.tokenService.getTokens(email);
            if (cachedTokens && this.tokenService.isTokenValid(cachedTokens.accessToken)) {
                logger.info('Retornando tokens do cache', {
                    email: logger.maskEmail(email)
                });
                return {
                    success: true,
                    email: cachedTokens.email,
                    accessToken: cachedTokens.accessToken,
                    idToken: cachedTokens.idToken,
                    refreshToken: cachedTokens.refreshToken,
                    accountancyToken: cachedTokens.accountancyToken || null,
                    expiresAt: cachedTokens.expiresAt
                };
            }

            // Tenta renovar tokens se existirem
            if (cachedTokens && cachedTokens.refreshToken) {
                try {
                    return await this.refreshTokens(email, cachedTokens.refreshToken, password, otp, req, isAdmin);
                } catch (refreshError) {
                    logger.warn('Falha ao renovar tokens, tentando autenticação completa', {
                        email: logger.maskEmail(email),
                        error: refreshError.message
                    });
                }
            }

            // Faz autenticação completa
            return await this.authenticate(email, password, otp, req, isAdmin);
        } catch (error) {
            logger.error('Erro no handleAuth', error, {
                email: logger.maskEmail(email),
                isAdmin
            });
            throw error;
        }
    }
}

module.exports = AuthService;

