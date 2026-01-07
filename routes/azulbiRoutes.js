const express = require('express');
const { capturarBookmarkState } = require('../services/capturar-bookmarkstate-api');
const logger = require('../utils/logger');

/**
 * Rotas para funcionalidades do Conta Azul BI
 */
function createAzulBIRoutes(db) {
    const router = express.Router();

    /**
     * POST /api/azulbi/capturar-bookmarkstate
     * 
     * Captura o bookmarkState para uma empresa específica
     * 
     * Body:
     * {
     *   "tenantId": 3267030,
     *   "reportId": "91d65d35-4cb2-428c-8c11-d4a00ae31fc9" (opcional),
     *   "accountancyToken": "token-aqui" (opcional, se não fornecido, busca do banco)
     * }
     */
    router.post('/capturar-bookmarkstate', async (req, res) => {
        try {
            const { tenantId, reportId, accountancyToken, headless = true } = req.body;

            if (!tenantId) {
                return res.status(400).json({
                    success: false,
                    error: 'tenantId é obrigatório'
                });
            }

            // Buscar accountancyToken do banco se não fornecido
            let token = accountancyToken;
            if (!token) {
                // Buscar do banco de dados (assumindo que temos o email do usuário autenticado)
                // Por enquanto, vamos exigir que seja fornecido
                return res.status(400).json({
                    success: false,
                    error: 'accountancyToken é obrigatório. Faça login primeiro em /admin/auth'
                });
            }

            logger.info('Iniciando captura de bookmarkState', { tenantId, reportId });

            // Capturar bookmarkState
            const bookmarkState = await capturarBookmarkState(
                token,
                tenantId,
                reportId,
                { headless: headless === true || headless === 'true' }
            );

            if (!bookmarkState) {
                return res.status(404).json({
                    success: false,
                    error: 'Não foi possível capturar o bookmarkState. O dashboard pode não ter carregado completamente ou o usuário precisa interagir com ele primeiro.'
                });
            }

            // Salvar no banco de dados (opcional)
            // TODO: Criar tabela bookmark_states se não existir
            // await db.saveBookmarkState(tenantId, bookmarkState);

            logger.info('bookmarkState capturado com sucesso', { tenantId, tamanho: bookmarkState.length });

            res.json({
                success: true,
                data: {
                    tenantId: tenantId,
                    bookmarkState: bookmarkState,
                    tamanho: bookmarkState.length,
                    capturedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Erro ao capturar bookmarkState', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Erro interno ao capturar bookmarkState'
            });
        }
    });

    /**
     * GET /api/azulbi/bookmarkstate/:tenantId
     * 
     * Retorna o bookmarkState salvo para uma empresa (se existir)
     */
    router.get('/bookmarkstate/:tenantId', async (req, res) => {
        try {
            const { tenantId } = req.params;

            // TODO: Buscar do banco de dados
            // const bookmarkState = await db.getBookmarkState(tenantId);

            res.json({
                success: false,
                error: 'Funcionalidade ainda não implementada. Use POST /capturar-bookmarkstate para capturar.'
            });

        } catch (error) {
            logger.error('Erro ao buscar bookmarkState', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Erro interno ao buscar bookmarkState'
            });
        }
    });

    return router;
}

module.exports = createAzulBIRoutes;

