const fs = require('fs');
const path = require('path');
const url = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const log4js = require('log4js');
const beautify = require('js-beautify').js_beautify;
const queue = require('queue');
const schedule = require('node-schedule');

const unpacker_filter = require('./lib');
const News = require('./model/news');

const PROTOCOL = 'http://';
const HOST = 'www.pbc.gov.cn';
const TARGET_URL = `${PROTOCOL}${HOST}`;
const LOG_CAT = 'pbc_crawl';
const URGENT_LOG = '[URGENT]';

const LOG_DIR = path.resolve(__dirname, 'logs');
log4js.configure({
  appenders: {
    app: {
      type: 'dateFile',
      filename: `logs/${LOG_CAT}.log`,
      maxLogSize: 20480,
      backups: 10,
    },
    out: {
      type: 'console'
    }
  },
  categories: {
    default: { appenders: [ 'out', 'app' ], level: 'debug' }
  }
});
const logger = log4js.getLogger();

/**
 * 解码 html
 * @param {*} res 
 * @param {*} charset 
 */
function decodeHtml(res, charset='utf8') {
  const html = iconv.decode(res, charset);
  return cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false
  });
}

/**
 * 默认请求头
 */
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36',
  Host: HOST,
  Referer: TARGET_URL
};

/**
 * 渗透目标站点安全防御措施，获取有效 cookie
 */
async function infiltrate() {
  logger.info('1.开始获取 JS 脚本...');
  const jsRes = await axios(TARGET_URL, {
    responseType: 'arraybuffer',
    headers: defaultHeaders,
    // proxy: {
    //   host: '61.155.164.110',
    //   port: 3128
    // },
  });
  const $ = decodeHtml(jsRes.data);
  const script = $('script').html().trim();
  if (!script) {
    logger.error('  获取 JS 脚本失败');
    
    return;
  }
  logger.info('  获取 JS 脚本成功');
  
  logger.info('2. 开始格式化 JS 脚本...');
  const tmp = path.resolve(__dirname, 'out.js');

  try {
    let out = beautify(unpacker_filter(script), { indent_size: 2 });
    out = out.replace('HXXTTKKLLPPP5();', 'module.exports = function() { return [ "wzwstemplate=" + KTKY2RBD9NHPBCIHV9ZMEQQDARSLVFDU(template.toString()), "wzwschallenge=" + KTKY2RBD9NHPBCIHV9ZMEQQDARSLVFDU(QWERTASDFGXYSF().toString()) ]; }');
    fs.writeFileSync(tmp, out, 'utf8');
    logger.info('  格式化 JS 脚本成功');
  } catch(e) {
    logger.error('  格式化 JS 脚本失败');
    
    return
  }

  logger.info('3. 开始执行 JS 脚本...');
  let cookiesFromJs;
  try {
    delete require.cache[tmp];
    cookiesFromJs = require(tmp)();
    logger.info('  执行 JS 脚本成功');
  } catch (e) {
    logger.error('  执行 JS 脚本失败');
  }
  
  logger.info('4. 组装获取 passport cookie 的 cookies...')
  const jsResCookies = formatResponseCookies(jsRes.headers['set-cookie']);
  const cookiesForGetPassportCookie = jsResCookies.concat(cookiesFromJs).join('; ');
  logger.info(`  组装 cookies 为 ${cookiesForGetPassportCookie}`);
  
  logger.info('5. 开始获取 passport cookie...');
  try {
    await axios(TARGET_URL, {
      headers: Object.assign({}, defaultHeaders, {
        Cookie: cookiesForGetPassportCookie
      }),
      maxRedirects: 0
    });
  } catch (err) {
    const responseCookies = err.response.headers['set-cookie'];
    const hasPassport = responseCookies.some((cookie) => {
      return cookie.indexOf('ccpassport=') !== -1;
    });

    if (!hasPassport) {
      logger.error('  获取 passport cookie 失败');
    }

    logger.info('  获取 passport cookie 成功');
    return formatResponseCookies(responseCookies);
  }
}

/**
 * 爬取首页新闻列表数据
 */
async function crawlHomePage() {
  logger.info('1. 获取主页面...')
  try {
    const homeRes = await axios(TARGET_URL, {
      headers: Object.assign({}, defaultHeaders, {
        Cookie: getUsefulCookies()
      }),
    });

    const $ = cheerio.load(homeRes.data, {
      normalizeWhitespace: true,
      decodeEntities: false
    });

    logger.info('  主页面获取成功');

    logger.info('2. 开始分析主页面数据...');
    const $title = $('#c_xwone .f16hs a').eq(0);
    const $list = $('#c_xwlist table td a');
    let ret = [];
    ret.push(parseLink($title));
    $list.each((i, link) => {
      ret.push(parseLink($(link)));
    });
    logger.info('  分析主页面数据成功');
    
    return ret;
  } catch (err) {
    logger.error(`  获取主页面失败, ${err.message}`);
  }
}

/**
 * 给 job 生成 id
 * @param {*} fn 
 * @param {*} id 
 */
function genIdentifiedJob(fn, id) {
  const _fn = fn;
  _fn.id = id;

  return _fn;
}

/**
 * 队列式抓取详情页面
 * @param {*} list 
 */
function loadDetailsUseQueue(list) {
  return new Promise(function (resolve, reject) {
    const q = queue();
    // 单个 job 超时时间
    q.timeout = 5000;
    // job 结果集
    let ret = [];

    list.forEach((item, index) => {
      q.push(genIdentifiedJob(function() {
        return axios(item.url, {
          headers: Object.assign({}, defaultHeaders, {
            Cookie: getUsefulCookies()
          })
        }).then((res) => {
          const detail = parseDetail(res.data);
          ret.push(Object.assign({}, list[index], detail));
        });
      }, index));
    });

    q.on('success', (result, job) => {
      logger.info(`job-${job.id} 成功`);
    });

    q.on('error', (err, job) => {
      logger.error(`job-${job.id} 出错, ${err.message}`);
    });

    q.on('timeout', (next, job) => {
      logger.error(`job-${job.id} 超时`);
      next();
    });

    q.start(function (err) {
      if (err) {
        logger.error(`jobs 出错: ${err.message}`);

        reject(err);

        return;
      }

      resolve(ret);
    });
  });
}

/**
 * 分析详情页面，提取数据
 * @param {*} html 
 */
function parseDetail(html) {
  const $ = cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false
  });
  const $media = $('#laiyuan');
  const media = $media.text() || '沟通交流';
  const date = $media.parent().next().text().trim();

  return {
    media, date
  };
}

/**
 * 获取页面安全访问 Cookies
 */
function getUsefulCookies() {
  return __cookies;
}

/**
 * 分析 a 标签，提取数据
 * @param {*}  
 */
function parseLink($link) {
  return {
    title: $link.attr('title'),
    url: `${TARGET_URL}${$link.attr('href')}`
  };
}

/**
 * 格式化服务端设置的 Cookies，供下次请求时设置 Request 的 Cookies
 * @param {*} cookies 
 */
function formatResponseCookies(cookies) {
  return cookies.map((cookie) => {
    return cookie.replace('; path=/', '');
  });
}

let __cookies;

/**
 * 爬取主流程
 */
async function crawl() {
  try {
    logger.info('------------ 渗透目标站点 -------------')
    __cookies = await infiltrate();

    logger.info('------------ 抓取新闻列表 -------------');
    const list = await crawlHomePage();
    logger.info(`列表数据：${JSON.stringify(list)}`);

    logger.info('------------ 抓取新闻详情 -------------');
    const details = await loadDetailsUseQueue(list);
    logger.info(`********** 成功抓取 ${details.length} 条新闻, 失败 ${list.length - details.length} 条 ***********`);
    logger.info(`详情数据：${JSON.stringify(details)}`);

    logger.info('------------ 写入数据库 -------------');
    // saveToDB(details);
  } catch (err) {
    logger.error(`抓取出错: ${err.message}`);
  }
}

/**
 * 保存爬取的数据到数据库
 * @param {*} data 
 */
function saveToDB(data) {
  if (!data || !data.length) {
    return;
  }

  const raw = data.map((detail) => {
    return {
      title: detail.title,
      url: detail.url,
      info_publ_date: detail.date,
      media: detail.media,
      tag: '新闻',
      channel: '央行'
    };
  });

  News.bulkCreate(raw)
    .then((news) => {
      const newsIds = news.map((news) => {
        return news.get('id')
      });
      
      logger.info(`写入数据库成功, ID 列表: ${newsIds.join()}`);
    }).catch((err) => {
      logger.error(`写入数据库出错: ${err.message}`);
    });
}

/**
 * 开启计划每 5 分钟爬取一次
 */
schedule.scheduleJob('*/5 * * * *', function(){
  logger.info('\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\n\n\n');
  crawl();
});