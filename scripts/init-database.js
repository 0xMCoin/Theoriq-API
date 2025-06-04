const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database/theoriq_staging.db');

// Create database and tables
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database.');
});

// Create tables sequentially
const initTables = () => {
    db.serialize(() => {
        // Weekly snapshots table - stores complete snapshots of data
        db.run(`
            CREATE TABLE IF NOT EXISTS weekly_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id TEXT UNIQUE NOT NULL,
                collection_date TEXT NOT NULL,
                window_period TEXT NOT NULL,
                is_live BOOLEAN NOT NULL,
                total_yappers INTEGER,
                total_tweets INTEGER,
                top_impressions INTEGER,
                top_likes INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating weekly_snapshots table:', err.message);
            } else {
                console.log('✅ Created weekly_snapshots table');
            }
        });

        // Yappers historical data
        db.run(`
            CREATE TABLE IF NOT EXISTS yappers_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id TEXT NOT NULL,
                rank INTEGER NOT NULL,
                username TEXT NOT NULL,
                mindshare REAL NOT NULL,
                tweets INTEGER NOT NULL,
                impressions INTEGER NOT NULL,
                likes INTEGER NOT NULL,
                twitter_url TEXT,
                collection_date TEXT NOT NULL,
                window_period TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (snapshot_id) REFERENCES weekly_snapshots (snapshot_id)
            )
        `, (err) => {
            if (err) {
                console.error('Error creating yappers_history table:', err.message);
            } else {
                console.log('✅ Created yappers_history table');
            }
        });

        // Webflow integration logs
        db.run(`
            CREATE TABLE IF NOT EXISTS webflow_sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id TEXT NOT NULL,
                sync_status TEXT NOT NULL,
                sync_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                response_data TEXT,
                error_message TEXT,
                FOREIGN KEY (snapshot_id) REFERENCES weekly_snapshots (snapshot_id)
            )
        `, (err) => {
            if (err) {
                console.error('Error creating webflow_sync_log table:', err.message);
            } else {
                console.log('✅ Created webflow_sync_log table');
            }
        });

        // Create indexes for better performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_date ON weekly_snapshots(collection_date)`, (err) => {
            if (err) {
                console.error('Error creating snapshot date index:', err.message);
            } else {
                console.log('✅ Created snapshot date index');
            }
        });

        db.run(`CREATE INDEX IF NOT EXISTS idx_yappers_snapshot ON yappers_history(snapshot_id)`, (err) => {
            if (err) {
                console.error('Error creating yappers snapshot index:', err.message);
            } else {
                console.log('✅ Created yappers snapshot index');
            }
        });

        db.run(`CREATE INDEX IF NOT EXISTS idx_yappers_rank ON yappers_history(rank)`, (err) => {
            if (err) {
                console.error('Error creating yappers rank index:', err.message);
            } else {
                console.log('✅ Created yappers rank index');
            }
        });

        db.run(`CREATE INDEX IF NOT EXISTS idx_yappers_date ON yappers_history(collection_date)`, (err) => {
            if (err) {
                console.error('Error creating yappers date index:', err.message);
            } else {
                console.log('✅ Created yappers date index');
                console.log('🗄️ Database initialization completed!');
                console.log(`📍 Database location: ${dbPath}`);
                
                // Close database connection after all operations
                db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err.message);
                    } else {
                        console.log('📊 Database connection closed');
                    }
                });
            }
        });
    });
};

// Initialize tables
initTables(); 