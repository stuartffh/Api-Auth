# Usa a imagem oficial do Node.js
FROM node:18

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Define variável de ambiente para produção
ENV NODE_ENV=production

# Adiciona um build arg para forçar rebuild quando necessário
# Use: docker build --build-arg CACHE_BUST=$(date +%s) ...
ARG CACHE_BUST=1
RUN echo "Build cache bust: $CACHE_BUST"

# Copia os arquivos de dependências primeiro (para aproveitar cache do Docker)
COPY package*.json ./

# Instala as dependências
RUN npm ci --only=production

# Remove diretórios antigos se existirem (para garantir atualização)
RUN rm -rf config middleware routes services utils 2>/dev/null || true

# Copia todos os arquivos da aplicação
# Usando COPY com timestamp para garantir atualização
COPY --chown=node:node config/ ./config/
COPY --chown=node:node middleware/ ./middleware/
COPY --chown=node:node routes/ ./routes/
COPY --chown=node:node services/ ./services/
COPY --chown=node:node utils/ ./utils/
COPY --chown=node:node server.js ./

# Verifica se os arquivos foram copiados
RUN test -f server.js || (echo "ERRO: server.js não encontrado" && exit 1) && \
    test -d config || (echo "ERRO: config/ não encontrado" && exit 1) && \
    test -d middleware || (echo "ERRO: middleware/ não encontrado" && exit 1) && \
    test -d routes || (echo "ERRO: routes/ não encontrado" && exit 1) && \
    test -d services || (echo "ERRO: services/ não encontrado" && exit 1) && \
    test -d utils || (echo "ERRO: utils/ não encontrado" && exit 1) && \
    echo "✅ Todos os arquivos foram copiados corretamente"

# Expõe a porta 4000 (ou a porta definida no .env)
EXPOSE 4000

# Comando para iniciar a aplicação
CMD ["node", "server.js"]

