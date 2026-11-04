const express = require('express');
const logger = require('morgan');

const app = express();

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
const indexRouter = require('./routes/index');

app.use('/', indexRouter);

module.exports = app;