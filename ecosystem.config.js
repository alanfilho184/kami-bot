module.exports = {
    apps: [
        {
            name: 'kami-bot',
            script: './dist/app.js',
            exec_mode: 'fork',
            env: {
                LD_PRELOAD: '/lib/x86_64-linux-gnu/libjemalloc.so.2'
            }
        }
    ]
};
