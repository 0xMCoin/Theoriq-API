const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

class TheoriqDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, 'theoriq_staging.db');
        this.db = null;
        this.init();
    }

    init() {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('Error connecting to database:', err.message);
            } else {
                console.log('📊 Database connected');
            }
        });
    }

    // Save a complete snapshot of metrics and yappers
    async saveSnapshot(metricsData, yappersData, windowPeriod = '7d', isLive = true) {
        return new Promise((resolve, reject) => {
            const snapshotId = uuidv4();
            const collectionDate = moment().format('YYYY-MM-DD');
            const timestamp = moment().toISOString();

            // Begin transaction
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                // Insert snapshot metadata
                const snapshotQuery = `
                    INSERT INTO weekly_snapshots 
                    (snapshot_id, collection_date, window_period, is_live, total_yappers, total_tweets, top_impressions, top_likes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;

                this.db.run(snapshotQuery, [
                    snapshotId,
                    collectionDate,
                    windowPeriod,
                    isLive ? 1 : 0,
                    metricsData.totalYappers,
                    metricsData.totalTweets,
                    metricsData.topImpressions,
                    metricsData.topLikes
                ], function(err) {
                    if (err) {
                        console.error('Error saving snapshot:', err.message);
                        reject(err);
                        return;
                    }

                    console.log(`📸 Snapshot saved with ID: ${snapshotId}`);
                });

                // Insert yappers data
                const yapperQuery = `
                    INSERT INTO yappers_history 
                    (snapshot_id, rank, username, mindshare, tweets, impressions, likes, twitter_url, collection_date, window_period)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                let yappersInserted = 0;
                const totalYappers = yappersData.length;

                yappersData.forEach((yapper) => {
                    this.db.run(yapperQuery, [
                        snapshotId,
                        yapper.rank,
                        yapper.username,
                        yapper.mindshare,
                        yapper.tweets,
                        yapper.impressions,
                        yapper.likes,
                        yapper.twitterUrl,
                        collectionDate,
                        windowPeriod
                    ], function(err) {
                        if (err) {
                            console.error('Error saving yapper:', err.message);
                        } else {
                            yappersInserted++;
                            if (yappersInserted === totalYappers) {
                                console.log(`👥 Saved ${yappersInserted} yappers for snapshot ${snapshotId}`);
                            }
                        }
                    });
                });

                // Commit transaction
                this.db.run('COMMIT', (err) => {
                    if (err) {
                        console.error('Error committing transaction:', err.message);
                        reject(err);
                    } else {
                        console.log('✅ Snapshot saved successfully');
                        resolve({
                            snapshotId,
                            collectionDate,
                            yappersCount: totalYappers,
                            timestamp
                        });
                    }
                });
            });
        });
    }

    // Get latest snapshot for Last 7 Days
    async getLatestSnapshot(windowPeriod = '7d') {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM weekly_snapshots 
                WHERE window_period = ?
                ORDER BY collection_date DESC, created_at DESC
                LIMIT 1
            `;

            this.db.get(query, [windowPeriod], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Get yappers for a specific snapshot
    async getYappersForSnapshot(snapshotId, limit = 250) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM yappers_history 
                WHERE snapshot_id = ?
                ORDER BY rank ASC
                LIMIT ?
            `;

            this.db.all(query, [snapshotId, limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Get historical snapshots
    async getHistoricalSnapshots(windowPeriod = '7d', limit = 10) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM weekly_snapshots 
                WHERE window_period = ?
                ORDER BY collection_date DESC, created_at DESC
                LIMIT ?
            `;

            this.db.all(query, [windowPeriod, limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Get complete snapshot with yappers
    async getCompleteSnapshot(snapshotId) {
        return new Promise(async (resolve, reject) => {
            try {
                const snapshot = await new Promise((res, rej) => {
                    this.db.get(
                        'SELECT * FROM weekly_snapshots WHERE snapshot_id = ?',
                        [snapshotId],
                        (err, row) => {
                            if (err) rej(err);
                            else res(row);
                        }
                    );
                });

                if (!snapshot) {
                    resolve(null);
                    return;
                }

                const yappers = await this.getYappersForSnapshot(snapshotId);

                resolve({
                    ...snapshot,
                    yappers
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Log Webflow sync attempt
    async logWebflowSync(snapshotId, status, responseData = null, errorMessage = null) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO webflow_sync_log 
                (snapshot_id, sync_status, response_data, error_message)
                VALUES (?, ?, ?, ?)
            `;

            this.db.run(query, [
                snapshotId,
                status,
                responseData ? JSON.stringify(responseData) : null,
                errorMessage
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID });
                }
            });
        });
    }

    // Get sync logs for a snapshot
    async getSyncLogs(snapshotId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM webflow_sync_log 
                WHERE snapshot_id = ?
                ORDER BY sync_date DESC
            `;

            this.db.all(query, [snapshotId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Clean old snapshots (keep last 12 weeks)
    async cleanOldSnapshots(weeksToKeep = 12) {
        return new Promise((resolve, reject) => {
            const cutoffDate = moment().subtract(weeksToKeep, 'weeks').format('YYYY-MM-DD');

            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                // Delete old yappers first (foreign key constraint)
                this.db.run(
                    'DELETE FROM yappers_history WHERE collection_date < ?',
                    [cutoffDate],
                    function(err) {
                        if (err) {
                            console.error('Error cleaning old yappers:', err.message);
                        } else {
                            console.log(`🗑️ Cleaned ${this.changes} old yapper records`);
                        }
                    }
                );

                // Delete old snapshots
                this.db.run(
                    'DELETE FROM weekly_snapshots WHERE collection_date < ?',
                    [cutoffDate],
                    function(err) {
                        if (err) {
                            console.error('Error cleaning old snapshots:', err.message);
                        } else {
                            console.log(`🗑️ Cleaned ${this.changes} old snapshots`);
                        }
                    }
                );

                this.db.run('COMMIT', (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    // Get database statistics
    async getStats() {
        return new Promise((resolve, reject) => {
            const queries = {
                totalSnapshots: 'SELECT COUNT(*) as count FROM weekly_snapshots',
                totalYappers: 'SELECT COUNT(*) as count FROM yappers_history',
                latestSnapshot: 'SELECT collection_date FROM weekly_snapshots ORDER BY created_at DESC LIMIT 1',
                syncLogs: 'SELECT COUNT(*) as count FROM webflow_sync_log'
            };

            const stats = {};
            let completed = 0;
            const total = Object.keys(queries).length;

            Object.entries(queries).forEach(([key, query]) => {
                this.db.get(query, [], (err, row) => {
                    if (err) {
                        stats[key] = 'Error';
                    } else {
                        stats[key] = row.count !== undefined ? row.count : row.collection_date;
                    }
                    
                    completed++;
                    if (completed === total) {
                        resolve(stats);
                    }
                });
            });
        });
    }

    // Close database connection
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err.message);
                } else {
                    console.log('📊 Database connection closed');
                }
            });
        }
    }
}

module.exports = TheoriqDatabase; 