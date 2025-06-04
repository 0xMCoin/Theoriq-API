const cron = require('node-cron');
const moment = require('moment');
const TheoriqDatabase = require('../database/database');

class SchedulerService {
    constructor(theoriqAPI) {
        this.api = theoriqAPI;
        this.db = new TheoriqDatabase();
        this.jobs = [];
    }

    // Schedule weekly data collection every Wednesday at 10:00 AM
    scheduleWeeklyCollection() {
        // Schedule for every Wednesday at 10:00 AM
        const job = cron.schedule('0 10 * * 3', async () => {
            console.log('📅 Weekly data collection started:', moment().format('YYYY-MM-DD HH:mm:ss'));
            await this.runWeeklyCollection();
        }, {
            scheduled: false,
            timezone: "America/New_York" // Adjust timezone as needed
        });

        this.jobs.push({ name: 'weekly-collection', job });
        return job;
    }

    // Schedule daily cleanup at 2:00 AM
    scheduleDailyCleanup() {
        const job = cron.schedule('0 2 * * *', async () => {
            console.log('🧹 Daily cleanup started:', moment().format('YYYY-MM-DD HH:mm:ss'));
            await this.runCleanup();
        }, {
            scheduled: false,
            timezone: "America/New_York"
        });

        this.jobs.push({ name: 'daily-cleanup', job });
        return job;
    }

    // Manual trigger for weekly collection
    async runWeeklyCollection() {
        try {
            console.log('🔄 Starting weekly data collection...');
            
            // Collect data for 7d window
            const result = await this.api.getData('7d');
            const metrics = this.api.extractMetrics(result.data);
            const yappers = this.api.extractYappers(result.data, 250);

            console.log(`📊 Collected metrics: ${metrics.totalYappers} yappers, ${metrics.totalTweets} tweets`);
            console.log(`👥 Collected ${yappers.length} yappers`);

            // Save to database
            const snapshot = await this.db.saveSnapshot(metrics, yappers, '7d', result.isLive);
            console.log(`💾 Snapshot saved: ${snapshot.snapshotId}`);

            return {
                success: true,
                snapshot,
                timestamp: moment().toISOString()
            };

        } catch (error) {
            console.error('❌ Weekly collection failed:', error.message);
            
            return {
                success: false,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }

    // Cleanup old data
    async runCleanup() {
        try {
            console.log('🧹 Running database cleanup...');
            await this.db.cleanOldSnapshots(12); // Keep 12 weeks of data
            console.log('✅ Cleanup completed');
            
            return { success: true, timestamp: moment().toISOString() };
        } catch (error) {
            console.error('❌ Cleanup failed:', error.message);
            return { success: false, error: error.message, timestamp: moment().toISOString() };
        }
    }

    // Start all scheduled jobs
    startAll() {
        this.jobs.forEach(({ name, job }) => {
            job.start();
            console.log(`⏰ Started scheduler: ${name}`);
        });
        
        console.log(`🚀 Scheduler service started with ${this.jobs.length} jobs`);
        console.log('📅 Weekly collection: Every Wednesday at 10:00 AM');
        console.log('🧹 Daily cleanup: Every day at 2:00 AM');
    }

    // Stop all scheduled jobs
    stopAll() {
        this.jobs.forEach(({ name, job }) => {
            job.stop();
            console.log(`⏹️ Stopped scheduler: ${name}`);
        });
    }

    // Get next scheduled run times
    getScheduleInfo() {
        const now = moment();
        const nextWednesday = moment().day(3).hour(10).minute(0).second(0);
        
        // If today is Wednesday and past 10 AM, or it's after Wednesday, get next Wednesday
        if (nextWednesday.isSameOrBefore(now)) {
            nextWednesday.add(1, 'week');
        }

        const nextCleanup = moment().add(1, 'day').hour(2).minute(0).second(0);
        if (nextCleanup.isSameOrBefore(now)) {
            nextCleanup.add(1, 'day');
        }

        return {
            nextWeeklyCollection: nextWednesday.format('YYYY-MM-DD HH:mm:ss'),
            nextCleanup: nextCleanup.format('YYYY-MM-DD HH:mm:ss'),
            activeJobs: this.jobs.length,
            timezone: 'America/New_York'
        };
    }

    // Test run - collect data but don't save
    async testRun() {
        try {
            console.log('🧪 Test run started...');
            
            const result = await this.api.getData('7d');
            const metrics = this.api.extractMetrics(result.data);
            const yappers = this.api.extractYappers(result.data, 10); // Just top 10 for testing

            return {
                success: true,
                test: true,
                metrics,
                yappers: yappers.slice(0, 5), // Return just top 5 for brevity
                isLive: result.isLive,
                timestamp: moment().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                test: true,
                error: error.message,
                timestamp: moment().toISOString()
            };
        }
    }
}

module.exports = SchedulerService; 