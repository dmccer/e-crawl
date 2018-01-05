// 中华周易网数据抓取
const fs = require('fs');
const path = require('path');
const url = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const HOST = 'http://www.zyrm.com/';
const ENTRY_PATH = '/guoxue/zy/';
const DESC_PATH = path.resolve(__dirname, './descs');
const BGLIST_FILE = path.join(DESC_PATH, './list.json');

async function loadBGList() {
  const res = await axios(url.resolve(HOST, ENTRY_PATH), {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36'
    }
  })
  return res.data;
}

async function loadBGDetail(url) {
  const res = await axios(url, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36',
      Cookie: 'fghvzecookieinforecord=%2C18-413%2C18-200%2C18-199%2C18-205%2C18-206%2C18-198%2C18-412%2C18-414%2C19-194%2C19-195%2C19-196%2C19-197%2C19-192%2C20-270%2C21-423%2C21-422%2C11-204%2C11-202%2C11-203%2C12-375%2C12-372%2C14-336%2C12-376%2C16-289%2C16-285%2C9-416%2C9-417%2C9-418%2C; preurl=/guoxue/zy/; captchaKey=2b5c398c00; captchaExpire=1511176278; fghvzcheckplkey=1511175990%2C4c010ab095e93e22a94928db56558082%2C50c3d67ae99967ace8ddf6566c9fb4c9'
    }
  })
  return res.data;
}

function decodeHtml(res) {
  const html = iconv.decode(res, 'gb2312')
  return cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false
  });
}

async function crawlBGList() {
  const listRes = await loadBGList();
  const $ = decodeHtml(listRes);

  const $tables = $('#text table');

  let ret = [];
  $tables.each((i, $table) => {
    const $trs = $('tr', $table);
    const $images = $('td', $trs[1]);

    let bgs = [];
    $images.each((i, $image) => {
      const $img = $('img', $image);
      const name = $img.attr('alt');
      const img = $img.attr('tppabs');
      const url = $img.parent().attr('tppabs');

      bgs.push({ name, img, url });
    });

    const title = $($table).prev().text();

    ret.push({ items: bgs, title });
  });
  
  let records = [];
  ret.forEach((group, i) => {
    group.items.forEach((bg, j) => {
      let r = {
        title: group.title
      };
      Object.assign(r, bg);

      records.push(r);
    });
  });

  return records;
}

async function start() {
  if (!fs.existsSync(DESC_PATH)) {
    fs.mkdirSync(DESC_PATH);
  }

  let bgList;

  if (!fs.existsSync(BGLIST_FILE)) {
    bgList = await crawlBGList();
    fs.writeFileSync(BGLIST_FILE, JSON.stringify(bgList));
  } else {
    bgList = require(BGLIST_FILE);
  }

  bgList.forEach(async (bg, i) => {
    const detailRes = await loadBGDetail(bg.url);
    const $ = decodeHtml(detailRes);

    const $img = $('table img');
    const detailImg = $img.attr('tppabs');
    
    const $fonts = $('font');
    const descs = [];
    $fonts.each((i, $font) => {
      descs.push($($font).html());
    });
    const desc = descs.join('<br />');

    bg.detailImg = detailImg;
    bg.desc = `<p>${desc}</p>`;

    fs.writeFileSync(path.join(DESC_PATH, `./${i}-${bg.name}.json`), JSON.stringify(bg));
  });
}

start();