# Instruções para Deploy no Easypanel

## Problema de Cache

Se os arquivos antigos estão sendo mantidos no Easypanel, siga estas instruções:

### Solução 1: Forçar Rebuild Sem Cache

No Easypanel, ao fazer o deploy:
1. Vá para as configurações de build
2. Adicione o argumento de build: `CACHE_BUST` com valor: `$(date +%s)`
3. Ou use a opção "Rebuild without cache" se disponível

### Solução 2: Limpar Cache Manualmente

Se o Easypanel tiver opção de limpar cache:
1. Limpe o cache de build
2. Faça um novo deploy

### Solução 3: Usar Build Args

No Dockerfile, adicione um build arg que pode ser usado para invalidar cache:

```bash
docker build --build-arg CACHE_BUST=$(date +%s) -t sua-imagem .
```

## Verificação

Após o deploy, verifique se os arquivos foram atualizados:

```bash
# Dentro do container
ls -la /app
ls -la /app/config
ls -la /app/middleware
ls -la /app/routes
ls -la /app/services
ls -la /app/utils
```

## Estrutura Esperada

```
/app
├── config/
│   ├── cognito.js
│   ├── database.js
│   └── env.js
├── middleware/
│   ├── errorHandler.js
│   ├── rateLimiter.js
│   └── validation.js
├── routes/
│   └── authRoutes.js
├── services/
│   ├── authService.js
│   └── tokenService.js
├── utils/
│   └── logger.js
├── server.js
└── package.json
```

## Variáveis de Ambiente Necessárias

Certifique-se de que estas variáveis estão configuradas no Easypanel:

- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- `COGNITO_USER_POOL_ID_ADMIN`
- `COGNITO_CLIENT_ID_ADMIN`
- `PORT` (opcional, padrão: 4000)
- `NODE_ENV` (opcional, padrão: production)



