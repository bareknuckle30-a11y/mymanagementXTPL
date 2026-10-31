module.exports = {
  apps: [{
    name: 'xtpl-taskmanager-api',
    cwd: '/var/www/xtpl-taskmanager/server',
    script: 'index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production', PORT: 5050 }
  }]
};
