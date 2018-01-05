const Sequelize = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('spider_ni_news', {
  title: Sequelize.STRING,
  media: Sequelize.STRING,
  info_publ_date: Sequelize.DATE,
  tag: Sequelize.ENUM('新闻'),
  channel: Sequelize.ENUM('央行'),
  url: Sequelize.STRING
}, {
  createdAt: false,
  updatedAt: false
});