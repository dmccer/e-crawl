const fs = require('fs');
const path = require('path');
const url = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const log4js = require('log4js');
const beautify = require('js-beautify').js_beautify;
const unpacker_filter = require('./lib');
const News = require('./model/news');

const PROTOCOL = 'http://';
const HOST = 'www.pbc.gov.cn';
const TARGET_URL = `${PROTOCOL}${HOST}`;
const ENTRY_PATH = '/';
const DESC_PATH = path.resolve(__dirname, './descs');
const BGLIST_FILE = path.join(DESC_PATH, './list.json');

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

async function loadList() {
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
    logger.info(' 分析主页面数据成功');
    
    return ret;
  } catch (err) {
    logger.error(`  获取主页面失败, ${err.message}`);
  }
}

async function loadDetail(list) {
  logger.info('1. 获取详情页面成功...');
  const reqs = list.map((item) => {
    return axios(item.url, {
      headers: Object.assign({}, defaultHeaders, {
        Cookie: getUsefulCookies()
      })
    });
  });

  return Promise.all(reqs)
    .then((res) => {
      logger.info('  获取详情页面成功');
      try {
        logger.info('2. 分析详情页面数据...');
        const ret = res.map((res, index) => {
          const detail = parseDetail(res.data);

          return Object.assign({}, list[index], detail);
        });
        logger.info('  分析详情页面数据成功');
        return ret;
      } catch (err) {
        logger.info(`  分析详情页面失败，${err.message}`);
      }
    })
    .catch((err) => {
      logger.error(`  获取详情页面失败，${err.message}`);
    });
}

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

function getUsefulCookies() {
  return __cookies;
}

function parseLink($link) {
  return {
    title: $link.attr('title'),
    url: `${TARGET_URL}${$link.attr('href')}`
  };
}

function formatResponseCookies(cookies) {
  return cookies.map((cookie) => {
    return cookie.replace('; path=/', '');
  });
}

let __cookies;

async function crawlList() {
  logger.info('------------ 渗透目标站点 -------------')
  __cookies = await infiltrate();
  logger.info('------------ 抓取新闻列表 -------------');
  const list = await loadList();
  logger.info('------------ 抓取新闻详情 -------------');
  const details = await loadDetail(list);

  logger.info(`列表数据：${JSON.stringify(list)}`);

  if (details && details.length) {
    logger.info(`********** 成功抓取 ${details.length} 条新闻, 失败 ${list.length - details.length} 条 ***********`);
    logger.info(`详情数据：${JSON.stringify(details)}`);

    const raw = details.map((detail) => {
      return {
        title: detail.title,
        url: detail.url,
        info_publ_date: detail.date,
        media: detail.media,
        tag: '新闻',
        channel: '央行'
      };
    })

    News.bulkCreate(raw).then((news) => {
      const newsIds = news.map((news) => {
        return news.get('id')
      });

      logger.info(`写入数据库 ID 列表: ${newsIds.join()}`);
    }).catch((err) => {
      console.log(`写入数据库出错: ${err.message}`);
    })
  } else {
    logger.info(`^^^^^^^^^^ 抓取新闻详情失败 ^^^^^^^^^^^^`);
  }
}

crawlList();