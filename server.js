const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const moment = require('moment');

// Import new services
const TheoriqDatabase = require('./database/database');
const SchedulerService = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    console.log('🔄 Server continuing to run...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('🔄 Server continuing to run...');
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Configuration
const API_CONFIG = {
    // PROXY URLs - Try multiple endpoints for better reliability
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
    }
    
    async getData(window = '7d') {
        // Try direct API first
        try {
            const directUrl = `${API_CONFIG.directUrl}?ticker=${API_CONFIG.ticker}&window=${window}`;
            const response = await fetch(directUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Direct API success');
                return { data, isLive: true };
            }
        } catch (error) {
            console.log('Direct API failed, trying proxies...');
        }
        
        // Try proxy endpoints
        for (let i = 0; i < API_CONFIG.proxyUrls.length; i++) {
            try {
                const proxyUrl = API_CONFIG.proxyUrls[i];
                let finalUrl;
                
                if (proxyUrl.includes('vercel.app')) {
                    // Custom proxy endpoint
                    finalUrl = `${proxyUrl}/${window}`;
                } else {
                    // Generic CORS proxy
                    const targetUrl = `${API_CONFIG.directUrl}?ticker=${API_CONFIG.ticker}&window=${window}`;
                    finalUrl = proxyUrl + encodeURIComponent(targetUrl);
                }
                
                const response = await fetch(finalUrl);
                
                if (response.ok) {
                    let data = await response.json();
                    
                    // Handle different proxy response formats
                    if (data.contents) {
                        data = JSON.parse(data.contents);
                    }
                    
                    console.log(`Proxy ${i + 1} success`);
                    return { data, isLive: true };
                }
            } catch (error) {
                console.log(`Proxy ${i + 1} failed:`, error);
            }
        }
        
        // All methods failed - throw error
        throw new Error('All API endpoints failed');
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
    
    extractYappers(apiResponse, limit = 250) {
        const yappers = apiResponse.community_mindshare.top_250_yappers || [];
        return yappers.slice(0, limit).map(yapper => ({
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
app.get('/api/data/:window?', async (req, res) => {
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
app.get('/api/metrics/:window?', async (req, res) => {
    try {
        const window = req.params.window || '7d';
        const result = await api.getData(window);
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
app.get('/api/yappers/:window?', async (req, res) => {
    try {
        const window = req.params.window || '7d';
        const limit = parseInt(req.query.limit) || 250;
        
        const result = await api.getData(window);
        const yappers = api.extractYappers(result.data, limit);
        
        res.json({
            success: true,
            isLive: result.isLive,
            yappers: yappers,
            count: yappers.length,
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
app.get('/api/dashboard/:window?', async (req, res) => {
    try {
        const window = req.params.window || '7d';
        const limit = parseInt(req.query.limit) || 250;
        
        const result = await api.getData(window);
        const metrics = api.extractMetrics(result.data);
        const yappers = api.extractYappers(result.data, limit);
        
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
app.get('/api/latest', async (req, res) => {
    try {
        const window = req.query.window || '7d';
        const limit = parseInt(req.query.limit) || 50;
        
        const snapshot = await db.getLatestSnapshot(window);
        
        if (!snapshot) {
            return res.json({
                success: false,
                error: 'No snapshots found',
                message: 'No historical data available. Run a collection first.',
                timestamp: new Date().toISOString()
            });
        }

        const yappers = await db.getYappersForSnapshot(snapshot.snapshot_id, limit);
        
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
app.get('/api/history', async (req, res) => {
    try {
        const window = req.query.window || '7d';
        const limit = parseInt(req.query.limit) || 10;
        
        const snapshots = await db.getHistoricalSnapshots(window, limit);
        
        res.json({
            success: true,
            snapshots: snapshots.map(s => ({
                id: s.snapshot_id,
                collectionDate: s.collection_date,
                windowPeriod: s.window_period,
                isLive: !!s.is_live,
                metrics: {
                    totalYappers: s.total_yappers,
                    totalTweets: s.total_tweets,
                    topImpressions: s.top_impressions,
                    topLikes: s.top_likes
                },
                createdAt: s.created_at
            })),
            count: snapshots.length,
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
app.get('/api/snapshot/:snapshotId', async (req, res) => {
    try {
        const snapshotId = req.params.snapshotId;
        const limit = parseInt(req.query.limit) || 250;
        
        const snapshot = await db.getCompleteSnapshot(snapshotId);
        
        if (!snapshot) {
            return res.status(404).json({
                success: false,
                error: 'Snapshot not found',
                timestamp: new Date().toISOString()
            });
        }

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
                yappers: snapshot.yappers.slice(0, limit).map(y => ({
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

// Manual trigger for data collection
app.post('/api/admin/collect', async (req, res) => {
    try {
        const result = await scheduler.runWeeklyCollection();
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
app.listen(PORT, () => {
    console.log(`🚀 Theoriq API Server v2.0 running on port ${PORT}`);
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