module.exports = {
    apps: [
        {
            name: 'kami-bot',
            script: './dist/app.js',
            cwd: __dirname,
            exec_mode: 'fork',
            kill_timeout: 8000,
            env: {
                NODE_ENV: 'production',
                LD_PRELOAD: '/lib/x86_64-linux-gnu/libjemalloc.so.2'
            }
        }
    ]
};
