# 🚀 Theoriq API Server - Database Integration

Servidor Node.js para coleta e armazenamento de dados da API Theoriq com histórico em banco SQLite.

## 📋 Funcionalidades

- ✅ **Coleta de Dados em Tempo Real**: Acesso direto à API Theoriq
- ✅ **Banco de Dados SQLite**: Armazenamento histórico de dados
- ✅ **Agendamento Automatizado**: Coleta semanal toda quarta-feira às 10h
- ✅ **APIs RESTful**: Endpoints para dados ao vivo e históricos
- ✅ **Dashboard Admin**: Ferramentas para gerenciamento e monitoramento
- ✅ **Limpeza Automática**: Mantém 12 semanas de histórico

## 🛠️ Instalação

```bash
# Clonar o repositório
git clone <repo-url>
cd LIT

# Instalar dependências
npm install

# Inicializar banco de dados
npm run init-db

# Iniciar servidor
npm start
```

## 📊 Endpoints da API

### Dados em Tempo Real

```bash
# Dashboard completo
GET /api/dashboard/:window
# Exemplo: GET /api/dashboard/7d

# Métricas processadas
GET /api/metrics/:window
# Exemplo: GET /api/metrics/7d

# Lista de yappers
GET /api/yappers/:window?limit=250
# Exemplo: GET /api/yappers/7d?limit=50

# Dados brutos da API
GET /api/data/:window
# Exemplo: GET /api/data/7d
```

### Dados Históricos do Banco

```bash
# Último snapshot salvo
GET /api/latest?window=7d&limit=50

# Histórico de snapshots
GET /api/history?window=7d&limit=10

# Snapshot específico
GET /api/snapshot/:snapshotId?limit=250
```

### Administração

```bash
# Coleta manual de dados
POST /api/admin/collect

# Teste sem salvar
GET /api/admin/test

# Informações do agendador
GET /api/admin/schedule

# Estatísticas do banco
GET /api/admin/stats

# Limpeza manual
POST /api/admin/cleanup

# Status do servidor
GET /api/health
```

## 🗄️ Estrutura do Banco de Dados

### weekly_snapshots
- `snapshot_id`: ID único do snapshot
- `collection_date`: Data da coleta
- `window_period`: Período de dados (7d, 30d, etc.)
- `is_live`: Se os dados estão ao vivo
- `total_yappers`: Total de yappers
- `total_tweets`: Total de tweets
- `top_impressions`: Total de impressões
- `top_likes`: Total de likes

### yappers_history  
- `snapshot_id`: Referência ao snapshot
- `rank`: Posição no ranking
- `username`: Nome do usuário
- `mindshare`: Valor de mindshare
- `tweets`: Número de tweets
- `impressions`: Impressões totais
- `likes`: Likes totais
- `twitter_url`: URL do perfil Twitter

## ⏰ Agendamento Automático

### Coleta Semanal
- **Frequência**: Toda quarta-feira às 10:00 AM
- **Timezone**: America/New_York
- **Dados**: Coleta automática dos dados 7d
- **Armazenamento**: Salva snapshot completo no banco

### Limpeza Diária
- **Frequência**: Todo dia às 02:00 AM
- **Retenção**: Mantém 12 semanas de dados
- **Limpeza**: Remove snapshots e yappers antigos

## 🔧 Configuração

### Variáveis de Ambiente (Opcional)

Crie um arquivo `.env` baseado em `config.example.env`:

```env
PORT=3000
TZ=America/New_York
DB_PATH=./database/theoriq_staging.db
```

### Scripts NPM

```bash
npm start       # Iniciar servidor
npm run dev     # Desenvolvimento com nodemon
npm run init-db # Inicializar banco de dados
```

## 📈 Exemplos de Uso

### 1. Obter Dados Atuais

```bash
curl http://localhost:3000/api/dashboard/7d
```

Resposta:
```json
{
  "success": true,
  "isLive": true,
  "window": "7d",
  "metrics": {
    "totalYappers": 2292,
    "totalTweets": 20698,
    "topImpressions": 3194808,
    "topLikes": 81131,
    "formattedMetrics": {
      "totalYappers": "2.3K",
      "totalTweets": "20.7K",
      "topImpressions": "3.2M",
      "topLikes": "81.1K"
    }
  },
  "yappers": [
    {
      "rank": 1,
      "username": "crypthoem",
      "mindshare": 0.0175,
      "tweets": 13,
      "impressions": 34234,
      "likes": 227,
      "twitterUrl": "https://twitter.com/crypthoem"
    }
  ]
}
```

### 2. Coletar Dados Manualmente

```bash
curl -X POST http://localhost:3000/api/admin/collect
```

Resposta:
```json
{
  "success": true,
  "snapshot": {
    "snapshotId": "e976989e-134c-48f4-84f2-ab19cc524fd3",
    "collectionDate": "2025-06-04",
    "yappersCount": 250,
    "timestamp": "2025-06-04T20:12:46.198Z"
  }
}
```

### 3. Obter Último Snapshot do Banco

```bash
curl "http://localhost:3000/api/latest?limit=5"
```

### 4. Ver Estatísticas do Sistema

```bash
curl http://localhost:3000/api/admin/stats
```

## 📁 Estrutura do Projeto

```
LIT/
├── server.js                # Servidor principal
├── package.json             # Dependências
├── README.md               # Documentação
├── config.example.env      # Configuração exemplo
├── database/
│   ├── database.js         # Classe do banco de dados
│   └── theoriq_staging.db  # Arquivo SQLite
├── services/
│   └── scheduler.js        # Serviço de agendamento
├── scripts/
│   └── init-database.js    # Script de inicialização
└── public/
    └── index.html         # Dashboard frontend (opcional)
```

## 🚦 Status do Sistema

Após iniciar o servidor, você verá:

```
🚀 Theoriq API Server v2.0 running on port 3000
📊 Dashboard: http://localhost:3000
🔗 API Endpoints:
   • GET /api/dashboard/:window - Complete dashboard data
   • GET /api/latest - Latest snapshot from database
   • GET /api/history - Historical snapshots
   • POST /api/admin/collect - Manual data collection
   • GET /api/admin/stats - Database statistics
📅 Automated collection: Every Wednesday at 10:00 AM
🗄️ Database: SQLite with historical storage
📊 Database connected
```

## 🔍 Monitoramento

### Health Check
```bash
curl http://localhost:3000/api/health
```

### Status do Agendador
```bash
curl http://localhost:3000/api/admin/schedule
```

### Estatísticas do Banco
```bash
curl http://localhost:3000/api/admin/stats
```

## 🛡️ Tratamento de Erros

O servidor implementa:
- ✅ Fallback para múltiplas APIs proxy
- ✅ Tratamento gracioso de falhas
- ✅ Logs detalhados de operações
- ✅ Shutdown gracioso do sistema
- ✅ Validação de dados de entrada

## 📝 Logs

O sistema gera logs detalhados:
- 📅 Coletas agendadas
- 💾 Operações de banco de dados  
- 🧹 Limpezas automáticas
- ❌ Erros e falhas
- ✅ Operações bem-sucedidas

## 🔧 Desenvolvimento

Para desenvolvimento, use:

```bash
npm run dev  # Inicia com nodemon para reload automático
```

## 📚 Dependências

- **express**: Framework web
- **cors**: Cross-origin resource sharing
- **node-fetch**: Cliente HTTP
- **sqlite3**: Banco de dados SQLite
- **node-cron**: Agendamento de tarefas
- **moment**: Manipulação de datas
- **uuid**: Geração de IDs únicos

---

## 🎯 Próximos Passos

O sistema está pronto para uso! Os dados são coletados automaticamente toda quarta-feira e ficam disponíveis através dos endpoints da API.

Para integração com frontend ou outras aplicações, use os endpoints documentados acima. 