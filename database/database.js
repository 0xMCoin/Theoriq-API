const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

class TheoriqDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'theoriq.db');
        this.db = null;
        this.connect();
    }

    connect() {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('❌ Database connection error:', err.message);
            } else {
                console.log('📊 Database connected');
            }
        });
    }

    // Save a complete snapshot of metrics and yappers
    async saveSnapshot(metrics, yappers, windowPeriod = '7d', isLive = true) {
        return new Promise((resolve, reject) => {
            const snapshotId = uuidv4();
            const collectionDate = moment().format('YYYY-MM-DD');
            
            this.db.serialize(() => {
                // Start transaction
                this.db.run('BEGIN TRANSACTION');

                // Insert snapshot metadata
                const snapshotStmt = this.db.prepare(`
                    INSERT INTO weekly_snapshots 
                    (snapshot_id, collection_date, window_period, total_yappers, total_tweets, top_impressions, top_likes, is_live)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                snapshotStmt.run([
                    snapshotId,
                    collectionDate,
                    windowPeriod,
                    metrics.totalYappers,
                    metrics.totalTweets,
                    metrics.topImpressions,
                    metrics.topLikes,
                    isLive ? 1 : 0
                ], (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        snapshotStmt.finalize();
                        reject(err);
                        return;
                    }

                    console.log(`📸 Snapshot saved with ID: ${snapshotId}`);

                    // Insert yappers data
                    const yapperStmt = this.db.prepare(`
                        INSERT INTO yappers_history 
                        (snapshot_id, rank, username, mindshare, tweets, impressions, likes, twitter_url)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    let processedYappers = 0;
                    const totalYappers = yappers.length;

                    yappers.forEach((yapper) => {
                        yapperStmt.run([
                            snapshotId,
                            yapper.rank,
                            yapper.username,
                            yapper.mindshare,
                            yapper.tweets,
                            yapper.impressions,
                            yapper.likes,
                            yapper.twitterUrl
                        ], (err) => {
                            if (err) {
                                console.error('❌ Error inserting yapper:', err);
                            }

                            processedYappers++;
                            
                            if (processedYappers === totalYappers) {
                                yapperStmt.finalize();
                                
                                // Commit transaction
                                this.db.run('COMMIT', (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        console.log(`👥 Saved ${processedYappers} yappers for snapshot ${snapshotId}`);
                                        console.log('✅ Snapshot saved successfully');
                                        
                                        resolve({
                                            snapshotId,
                                            collectionDate,
                                            windowPeriod,
                                            yapperCount: processedYappers,
                                            metrics,
                                            timestamp: moment().toISOString()
                                        });
                                    }
                                });
                            }
                        });
                    });
                });

                snapshotStmt.finalize();
            });
        });
    }

    // Get latest snapshot for a specific window
    async getLatestSnapshot(windowPeriod = '7d') {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM weekly_snapshots 
                WHERE window_period = ? 
                ORDER BY created_at DESC 
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
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            
            this.db.all(query, [windowPeriod, limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        success: true,
                        snapshots: rows,
                        count: rows.length
                    });
                }
            });
        });
    }

    // Get complete snapshot with yappers
    async getCompleteSnapshot(snapshotId, limit = 250) {
        return new Promise(async (resolve, reject) => {
            try {
                // Get snapshot metadata
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

                // Get yappers for this snapshot
                const yappers = await this.getYappersForSnapshot(snapshotId, limit);

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
    async logWebflowSync(snapshotId, status, itemsSynced = 0, errorMessage = null) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO webflow_sync_log (snapshot_id, sync_status, items_synced, error_message)
                VALUES (?, ?, ?, ?)
            `);

            stmt.run([snapshotId, status, itemsSynced, errorMessage], function(err) {
                stmt.finalize();
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        logId: this.lastID,
                        snapshotId,
                        status,
                        itemsSynced,
                        timestamp: moment().toISOString()
                    });
                }
            });
        });
    }

    // Clean old snapshots (keep only last N weeks)
    async cleanOldSnapshots(weeksToKeep = 12) {
        return new Promise((resolve, reject) => {
            const cutoffDate = moment().subtract(weeksToKeep, 'weeks').format('YYYY-MM-DD');
            
            this.db.serialize(() => {
                // Get snapshots to delete
                this.db.all(
                    'SELECT snapshot_id FROM weekly_snapshots WHERE collection_date < ?',
                    [cutoffDate],
                    (err, rows) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (rows.length === 0) {
                            resolve({ deletedSnapshots: 0, deletedYappers: 0 });
                            return;
                        }

                        const snapshotIds = rows.map(row => row.snapshot_id);
                        const placeholders = snapshotIds.map(() => '?').join(',');

                        // Delete yappers first (foreign key constraint)
                        this.db.run(
                            `DELETE FROM yappers_history WHERE snapshot_id IN (${placeholders})`,
                            snapshotIds,
                            function(err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                const deletedYappers = this.changes;
                                console.log(`🗑️ Cleaned ${deletedYappers} old yapper records`);

                                // Delete snapshots
                                this.db.run(
                                    `DELETE FROM weekly_snapshots WHERE collection_date < ?`,
                                    [cutoffDate],
                                    function(err) {
                                        if (err) {
                                            reject(err);
                                        } else {
                                            const deletedSnapshots = this.changes;
                                            console.log(`🗑️ Cleaned ${deletedSnapshots} old snapshots`);
                                            
                                            resolve({
                                                deletedSnapshots,
                                                deletedYappers,
                                                cutoffDate
                                            });
                                        }
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    }

    // Get database statistics - FIXED VERSION
    async getStats() {
        return new Promise((resolve, reject) => {
            const stats = {
                totalSnapshots: 0,
                totalYappers: 0,
                latestSnapshot: null,
                syncLogs: 0
            };

            let completedQueries = 0;
            const totalQueries = 4;

            const checkComplete = () => {
                completedQueries++;
                if (completedQueries === totalQueries) {
                    resolve({
                        success: true,
                        ...stats
                    });
                }
            };

            // Count total snapshots
            this.db.get('SELECT COUNT(*) as count FROM weekly_snapshots', (err, row) => {
                if (err) {
                    console.error('Error counting snapshots:', err);
                    stats.totalSnapshots = 0;
                } else {
                    stats.totalSnapshots = row && row.count !== undefined ? row.count : 0;
                }
                checkComplete();
            });

            // Count total yappers
            this.db.get('SELECT COUNT(*) as count FROM yappers_history', (err, row) => {
                if (err) {
                    console.error('Error counting yappers:', err);
                    stats.totalYappers = 0;
                } else {
                    stats.totalYappers = row && row.count !== undefined ? row.count : 0;
                }
                checkComplete();
            });

            // Get latest snapshot date
            this.db.get('SELECT collection_date FROM weekly_snapshots ORDER BY created_at DESC LIMIT 1', (err, row) => {
                if (err) {
                    console.error('Error getting latest snapshot:', err);
                    stats.latestSnapshot = null;
                } else {
                    stats.latestSnapshot = row && row.collection_date ? row.collection_date : null;
                }
                checkComplete();
            });

            // Count sync logs
            this.db.get('SELECT COUNT(*) as count FROM webflow_sync_log', (err, row) => {
                if (err) {
                    console.error('Error counting sync logs:', err);
                    stats.syncLogs = 0;
                } else {
                    stats.syncLogs = row && row.count !== undefined ? row.count : 0;
                }
                checkComplete();
            });
        });
    }

    // Close database connection
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err.message);
                } else {
                    console.log('📊 Database connection closed');
                }
            });
        }
    }
}

module.exports = TheoriqDatabase; 