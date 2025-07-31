// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const compression = require('compression');

const TheoriqDatabase = require('./database/database');
const SchedulerService = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const apiCache = new NodeCache({ stdTTL: 300 });

process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    console.log('🔄 Server continuing to run...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('🔄 Server continuing to run...');
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use(helmet());
app.use(compression());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    message: {
        success: false,
        error: 'Muitas requisições deste IP, tente novamente após 15 minutos',
        timestamp: new Date().toISOString()
    }
});

app.use('/api/', apiLimiter);

const validateParams = (req, res, next) => {
    if (req.params.window && !['7d', '30d', '3m', '6m', '12m'].includes(req.params.window)) {
        return res.status(400).json({
            success: false,
            error: 'Período inválido',
            validValues: ['7d', '30d', '3m', '6m', '12m'],
            timestamp: new Date().toISOString()
        });
    }

    if (req.query.limit) {
        const limit = parseInt(req.query.limit);
        if (isNaN(limit) || limit <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Valor de limite inválido, deve ser um número positivo',
                timestamp: new Date().toISOString()
            });
        }

        req.query.limit = Math.min(limit, 250);
    }

    if (req.query.offset) {
        const offset = parseInt(req.query.offset);
        if (isNaN(offset) || offset < 0) {
            return res.status(400).json({
                success: false,
                error: 'Valor de offset inválido, deve ser um número não-negativo',
                timestamp: new Date().toISOString()
            });
        }
        req.query.offset = offset;
    } else {
        req.query.offset = 0; // Default offset
    }

    next();
};

// Middleware de cache para APIs
const cacheMiddleware = (duration) => {
    return (req, res, next) => {
        const key = req.originalUrl;
        const cachedResponse = apiCache.get(key);

        if (cachedResponse) {
            return res.json(cachedResponse);
        }

        // Armazenar a resposta original para interceptá-la
        const originalSend = res.json;
        res.json = function (body) {
            // Armazenar no cache apenas respostas de sucesso
            if (body && body.success) {
                apiCache.set(key, body, duration);
            }
            originalSend.call(this, body);
        };

        next();
    };
};

const API_CONFIG = {
    proxyUrls: [
        'https://theoriq-proxy.vercel.app/api/theoriq',
        'https://api.allorigins.win/get?url=',
        'https://corsproxy.io/?'
    ],
    directUrl: 'https://api.kaito.ai/api/v1/community_mindshare',
    ticker: 'THEORIQ'
};

// API Class
class TheoriqAPI {
    constructor() {
        this.currentProxyIndex = 0;
        this.cache = {};
        this.cacheTTL = 5 * 60 * 1000;
    }

    async getData(window = '7d') {
        const cacheKey = `data_${window}`;
        const cachedData = this.checkCache(cacheKey);
        if (cachedData) return cachedData;

        try {
            const directUrl = `${API_CONFIG.directUrl}?ticker=${API_CONFIG.ticker}&window=${window}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(directUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'x-api-key': process.env.KAITO_API_KEY
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                const result = { data, isLive: true };
                this.setCache(cacheKey, result);
                return result;
            } else {
                console.log('Direct API failed', response.status, await response.text());
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Direct API timeout after 5 seconds');
            } else {
                console.log('Direct API failed:', error.message);
            }
        }
        throw new Error('All API endpoints failed');
    }

    checkCache(key) {
        const cachedItem = this.cache[key];
        if (cachedItem && (Date.now() - cachedItem.timestamp) < this.cacheTTL) {
            return cachedItem.data;
        }
        return null;
    }

    setCache(key, data) {
        this.cache[key] = {
            data,
            timestamp: Date.now()
        };
    }

    clearCache() {
        this.cache = {};
    }

    extractMetrics(apiResponse) {
        const data = apiResponse.community_mindshare;
        return {
            totalYappers: data.total_unique_yappers,
            totalTweets: data.total_unique_tweets,
            topImpressions: data.top_250_yapper_impressions,
            topLikes: data.top_250_yapper_likes
        };
    }

    extractYappers(apiResponse, limit = 250, offset = 0) {
        const yappers = apiResponse.community_mindshare.top_250_yappers || [];
        return yappers.slice(offset, offset + limit).map(yapper => ({
            rank: parseInt(yapper.rank),
            username: yapper.username,
            mindshare: parseFloat(yapper.mindshare),
            tweets: parseInt(yapper.tweet_counts),
            impressions: parseInt(yapper.total_impressions),
            likes: parseInt(yapper.total_likes),
            twitterUrl: `https://twitter.com/${yapper.username}`
        }));
    }
}

// Initialize services
const api = new TheoriqAPI();
const db = new TheoriqDatabase();
const scheduler = new SchedulerService(api);

// Initialize database tables
const initDatabase = async () => {
    try {
        console.log('🗄️ Initializing database tables...');
        await db.initTables();
        console.log('✅ Database tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database tables:', error);
        console.log('⚠️ Continuing server startup despite database error');
    }
};

// Utility function to format numbers
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

// ============= ORIGINAL API ROUTES =============

// Get raw API data
app.get('/api/data/:window?', validateParams, cacheMiddleware(300), async (req, res) => {
    try {
        const window = req.params.window || '7d';
        const result = await api.getData(window);
        res.json({
            success: true,
            isLive: result.isLive,
            data: result.data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get processed metrics
app.get('/api/metrics/:window?', validateParams, cacheMiddleware(300), async (req, res) => {
    try {
        const window = req.params.window || '7d';
        const result = await api.getData(window);
        console.log("result", result);
        const metrics = api.extractMetrics(result.data);

        res.json({
            success: true,
            isLive: result.isLive,
            metrics: {
                ...metrics,
                formattedMetrics: {
                    totalYappers: formatNumber(metrics.totalYappers),
                    totalTweets: formatNumber(metrics.totalTweets),
                    topImpressions: formatNumber(metrics.topImpressions),
                    topLikes: formatNumber(metrics.topLikes)
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching metrics:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get yappers leaderboard
app.get('/api/yappers/:window?', validateParams, cacheMiddleware(300), async (req, res) => {
    try {
        const window = req.params.window || '7d';
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const result = await api.getData(window);
        const allYappers = result.data.community_mindshare.top_250_yappers || [];
        const yappers = api.extractYappers(result.data, limit, offset);

        res.json({
            success: true,
            isLive: result.isLive,
            yappers: yappers,
            pagination: {
                total: allYappers.length,
                limit,
                offset,
                hasMore: offset + limit < allYappers.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching yappers:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get complete dashboard data
app.get('/api/dashboard/:window?', validateParams, cacheMiddleware(300), async (req, res) => {
    try {
        const window = req.params.window || '7d';
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const result = await api.getData(window);
        const metrics = api.extractMetrics(result.data);
        const allYappers = result.data.community_mindshare.top_250_yappers || [];
        const yappers = api.extractYappers(result.data, limit, offset);

        res.json({
            success: true,
            isLive: result.isLive,
            window: window,
            metrics: {
                ...metrics,
                formattedMetrics: {
                    totalYappers: formatNumber(metrics.totalYappers),
                    totalTweets: formatNumber(metrics.totalTweets),
                    topImpressions: formatNumber(metrics.topImpressions),
                    topLikes: formatNumber(metrics.topLikes)
                }
            },
            yappers: yappers,
            pagination: {
                total: allYappers.length,
                limit,
                offset,
                hasMore: offset + limit < allYappers.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ============= DATABASE & HISTORICAL ROUTES =============

// Get latest snapshot from database (for "Last 7 Days Swarms")
app.get('/api/latest', validateParams, cacheMiddleware(600), async (req, res) => {
    try {
        const window = req.query.window || '7d';
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const snapshot = await db.getLatestSnapshot(window);

        if (!snapshot) {
            return res.json({
                success: false,
                error: 'No snapshots found',
                message: 'No historical data available. Run a collection first.',
                timestamp: new Date().toISOString()
            });
        }

        // Obter contagem total de yappers no snapshot
        const totalYappers = await db.getYapperCountForSnapshot(snapshot.snapshot_id);
        const yappers = await db.getYappersForSnapshot(snapshot.snapshot_id, limit, offset);

        res.json({
            success: true,
            snapshot: {
                id: snapshot.snapshot_id,
                collectionDate: snapshot.collection_date,
                isLive: !!snapshot.is_live,
                metrics: {
                    totalYappers: snapshot.total_yappers,
                    totalTweets: snapshot.total_tweets,
                    topImpressions: snapshot.top_impressions,
                    topLikes: snapshot.top_likes,
                    formattedMetrics: {
                        totalYappers: formatNumber(snapshot.total_yappers),
                        totalTweets: formatNumber(snapshot.total_tweets),
                        topImpressions: formatNumber(snapshot.top_impressions),
                        topLikes: formatNumber(snapshot.top_likes)
                    }
                },
                yappers: yappers.map(y => ({
                    rank: y.rank,
                    username: y.username,
                    mindshare: y.mindshare,
                    tweets: y.tweets,
                    impressions: y.impressions,
                    likes: y.likes,
                    twitterUrl: y.twitter_url
                }))
            },
            pagination: {
                total: totalYappers,
                limit,
                offset,
                hasMore: offset + limit < totalYappers
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching latest snapshot:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get historical snapshots
app.get('/api/history', validateParams, cacheMiddleware(600), async (req, res) => {
    try {
        const window = req.query.window || '7d';
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        const totalCount = await db.getSnapshotCount(window);
        const result = await db.getHistoricalSnapshots(window, limit, offset);

        res.json({
            success: true,
            snapshots: result.snapshots || [],
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: offset + limit < totalCount
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching historical data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get specific snapshot with yappers
app.get('/api/snapshot/:snapshotId', validateParams, cacheMiddleware(600), async (req, res) => {
    try {
        const snapshotId = req.params.snapshotId;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const snapshot = await db.getCompleteSnapshot(snapshotId, limit, offset);

        if (!snapshot) {
            return res.status(404).json({
                success: false,
                error: 'Snapshot not found',
                timestamp: new Date().toISOString()
            });
        }

        // Obter contagem total de yappers no snapshot
        const totalYappers = await db.getYapperCountForSnapshot(snapshotId);

        res.json({
            success: true,
            snapshot: {
                id: snapshot.snapshot_id,
                collectionDate: snapshot.collection_date,
                windowPeriod: snapshot.window_period,
                isLive: !!snapshot.is_live,
                metrics: {
                    totalYappers: snapshot.total_yappers,
                    totalTweets: snapshot.total_tweets,
                    topImpressions: snapshot.top_impressions,
                    topLikes: snapshot.top_likes
                },
                yappers: snapshot.yappers.map(y => ({
                    rank: y.rank,
                    username: y.username,
                    mindshare: y.mindshare,
                    tweets: y.tweets,
                    impressions: y.impressions,
                    likes: y.likes,
                    twitterUrl: y.twitter_url
                })),
                createdAt: snapshot.created_at
            },
            pagination: {
                total: totalYappers,
                limit,
                offset,
                hasMore: offset + limit < totalYappers
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching snapshot:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ============= SCHEDULER & ADMIN ROUTES =============

// Rate limiter mais restritivo para rotas admin
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20, // Limite de 20 requisições por IP
    standardHeaders: true,
    message: {
        success: false,
        error: 'Muitas requisições admin deste IP, tente novamente após 15 minutos',
        timestamp: new Date().toISOString()
    }
});

// Aplicar limitador nas rotas admin
app.use('/api/admin/', adminLimiter);

// Cache control - limpar cache
app.post('/api/admin/clear-cache', async (req, res) => {
    try {
        // Limpar cache do Node-Cache
        apiCache.flushAll();

        // Limpar cache interno da API
        api.clearCache();

        res.json({
            success: true,
            message: 'Cache limpo com sucesso',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Manual trigger for data collection
app.post('/api/admin/collect', async (req, res) => {
    try {
        const result = await scheduler.runWeeklyCollection();

        // Limpar cache após coleta de dados
        apiCache.flushAll();
        api.clearCache();

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Test run (doesn't save to database)
app.get('/api/admin/test', async (req, res) => {
    try {
        const result = await scheduler.testRun();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get scheduler info
app.get('/api/admin/schedule', (req, res) => {
    const scheduleInfo = scheduler.getScheduleInfo();
    res.json({
        success: true,
        schedule: scheduleInfo,
        timestamp: new Date().toISOString()
    });
});

// Database statistics
app.get('/api/admin/stats', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json({
            success: true,
            database: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Manual cleanup
app.post('/api/admin/cleanup', async (req, res) => {
    try {
        const result = await scheduler.runCleanup();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Test API connection endpoint
app.get('/api/admin/test-connection', async (req, res) => {
    try {
        // Check if API key is configured
        if (!process.env.KAITO_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'KAITO_API_KEY environment variable not configured',
                timestamp: new Date().toISOString()
            });
        }

        // Test API call with minimal window
        const testUrl = `${API_CONFIG.directUrl}?ticker=${API_CONFIG.ticker}&window=7d`;
        console.log('Testing API connection to:', testUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds for test

        const response = await fetch(testUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'x-api-key': process.env.KAITO_API_KEY
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const responseText = await response.text();
        let responseData;

        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            responseData = responseText;
        }

        res.json({
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            hasApiKey: !!process.env.KAITO_API_KEY,
            apiKeyLength: process.env.KAITO_API_KEY ? process.env.KAITO_API_KEY.length : 0,
            ticker: API_CONFIG.ticker,
            url: testUrl,
            response: responseData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.name === 'AbortError' ? 'Connection timeout' : error.message,
            hasApiKey: !!process.env.KAITO_API_KEY,
            timestamp: new Date().toISOString()
        });
    }
});

// ============= SCHEDULER TESTING ROUTES =============

// Test all scheduler components
app.get('/api/admin/test-scheduler', async (req, res) => {
    try {
        const SchedulerTester = require('./test-scheduler');
        const tester = new SchedulerTester();

        const results = await tester.runFullTest();

        res.json({
            success: true,
            testResults: results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Test specific scheduler component
app.get('/api/admin/test-scheduler/:component', async (req, res) => {
    try {
        const SchedulerTester = require('./test-scheduler');
        const tester = new SchedulerTester();
        const component = req.params.component;

        let result;

        switch (component) {
            case 'instances':
                result = await tester.testInstances();
                break;
            case 'weekly':
                result = await tester.testWeeklyCollection();
                break;
            case 'cleanup':
                result = await tester.testCleanup();
                break;
            case 'api':
                result = await tester.testAPIConnection();
                break;
            case 'schedule':
                result = await tester.testScheduleInfo();
                break;
            case 'history':
                result = await tester.testSnapshotHistory();
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid component',
                    validComponents: ['instances', 'weekly', 'cleanup', 'api', 'schedule', 'history'],
                    timestamp: new Date().toISOString()
                });
        }

        res.json({
            success: true,
            component: component,
            result: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Simulate scheduled run
app.post('/api/admin/simulate/:type', async (req, res) => {
    try {
        const type = req.params.type;

        if (type !== 'weekly' && type !== 'cleanup') {
            return res.status(400).json({
                success: false,
                error: 'Invalid simulation type',
                validTypes: ['weekly', 'cleanup'],
                timestamp: new Date().toISOString()
            });
        }

        const SchedulerTester = require('./test-scheduler');
        const tester = new SchedulerTester();

        const result = await tester.simulateScheduledRun(type);

        res.json({
            success: true,
            simulation: type,
            result: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get next scheduled execution times with countdown
app.get('/api/admin/schedule-countdown', (req, res) => {
    try {
        const scheduleInfo = scheduler.getScheduleInfo();
        const moment = require('moment');

        const now = moment();
        const nextCollection = moment(scheduleInfo.nextWeeklyCollection);
        const nextCleanup = moment(scheduleInfo.nextCleanup);

        const timeToCollection = nextCollection.diff(now, 'seconds');
        const timeToCleanup = nextCleanup.diff(now, 'seconds');

        const formatDuration = (seconds) => {
            const duration = moment.duration(seconds, 'seconds');
            const days = Math.floor(duration.asDays());
            const hours = duration.hours();
            const minutes = duration.minutes();
            const secs = duration.seconds();

            if (days > 0) {
                return `${days}d ${hours}h ${minutes}m`;
            } else if (hours > 0) {
                return `${hours}h ${minutes}m ${secs}s`;
            } else if (minutes > 0) {
                return `${minutes}m ${secs}s`;
            } else {
                return `${secs}s`;
            }
        };

        res.json({
            success: true,
            schedule: {
                nextWeeklyCollection: {
                    datetime: scheduleInfo.nextWeeklyCollection,
                    countdown: formatDuration(timeToCollection),
                    secondsRemaining: timeToCollection
                },
                nextCleanup: {
                    datetime: scheduleInfo.nextCleanup,
                    countdown: formatDuration(timeToCleanup),
                    secondsRemaining: timeToCleanup
                },
                activeJobs: scheduleInfo.activeJobs,
                timezone: scheduleInfo.timezone,
                isWeeklyCollectionDay: now.day() === 3 && now.hour() >= 10 && now.hour() < 11,
                isCleanupTime: now.hour() >= 2 && now.hour() < 3
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Force trigger schedule (with override)
app.post('/api/admin/force-schedule/:type', async (req, res) => {
    try {
        const type = req.params.type;
        const override = req.query.override === 'true';

        if (!override) {
            return res.status(400).json({
                success: false,
                error: 'Force schedule requires override=true parameter',
                message: 'Add ?override=true to confirm forced execution',
                timestamp: new Date().toISOString()
            });
        }

        let result;

        switch (type) {
            case 'weekly':
                console.log('🚨 FORCED WEEKLY COLLECTION TRIGGERED');
                result = await scheduler.runWeeklyCollection();
                break;
            case 'cleanup':
                console.log('🚨 FORCED CLEANUP TRIGGERED');
                result = await scheduler.runCleanup();
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid schedule type',
                    validTypes: ['weekly', 'cleanup'],
                    timestamp: new Date().toISOString()
                });
        }

        res.json({
            success: true,
            forcedExecution: type,
            result: result,
            warning: 'This was a forced execution outside normal schedule',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
            database: 'connected',
            scheduler: 'active'
        }
    });
});

// Serve frontend if index.html exists
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            res.json({
                message: 'Theoriq API Server with Database Integration',
                version: '2.0.0',
                endpoints: {
                    // Original endpoints
                    dashboard: '/api/dashboard/:window (7d, 30d, 90d)',
                    metrics: '/api/metrics/:window',
                    yappers: '/api/yappers/:window?limit=250',
                    data: '/api/data/:window',

                    // Database endpoints
                    latest: '/api/latest?window=7d&limit=50',
                    history: '/api/history?window=7d&limit=10',
                    snapshot: '/api/snapshot/:snapshotId?limit=250',

                    // Admin endpoints
                    collect: 'POST /api/admin/collect',
                    test: '/api/admin/test',
                    schedule: '/api/admin/schedule',
                    stats: '/api/admin/stats',
                    cleanup: 'POST /api/admin/cleanup',
                    testConnection: '/api/admin/test-connection', // Added new endpoint

                    health: '/api/health'
                },
                features: [
                    'Live API data collection',
                    'Historical data storage',
                    'Weekly automated snapshots',
                    'Database management',
                    'Admin dashboard'
                ]
            });
        }
    });
});

// Start scheduler
scheduler.scheduleWeeklyCollection();
scheduler.scheduleDailyCleanup();
scheduler.startAll();

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 Theoriq API Server v2.0 running on port ${PORT}`);
    await initDatabase();
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔗 API Endpoints:`);
    console.log(`   • GET /api/dashboard/:window - Complete dashboard data`);
    console.log(`   • GET /api/latest - Latest snapshot from database`);
    console.log(`   • GET /api/history - Historical snapshots`);
    console.log(`   • POST /api/admin/collect - Manual data collection`);
    console.log(`   • GET /api/admin/stats - Database statistics`);
    console.log(`📅 Automated collection: Every Wednesday at 10:00 AM`);
    console.log(`🗄️ Database: SQLite with historical storage`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    scheduler.stopAll();
    db.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    scheduler.stopAll();
    db.close();
    process.exit(0);
});

module.exports = app; 