const Sequelize = require('sequelize');

module.exports = new Sequelize('spider', 'spider', 'spider', {
  host: '10.199.103.150',
  dialect: 'mysql',
  port: 5508,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },

  // http://docs.sequelizejs.com/manual/tutorial/querying.html#operators
  operatorsAliases: false
});

