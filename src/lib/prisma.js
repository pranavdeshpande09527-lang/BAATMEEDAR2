'use strict';
const { PrismaClient } = require('@prisma/client');
const { logger } = require('./logger');

// Singleton Prisma client — prevents connection pool exhaustion in dev
const prisma = global.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ]
    : [{ emit: 'event', level: 'error' }],
});

// Forward Prisma log events to the structured logger
prisma.$on('warn',  (e) => logger.warn({ source: 'prisma', message: e.message }, 'Prisma warning'));
prisma.$on('error', (e) => logger.error({ source: 'prisma', message: e.message }, 'Prisma error'));

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

module.exports = prisma;
