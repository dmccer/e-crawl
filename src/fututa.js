const fs = require('fs');
const path = require('path');
const url = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const HOST = 'http://baike.fututa.com/';
const ENTRY_PATH = '/zhouyi64gua/';
const DESC_PATH = path.resolve(__dirname, './descs');
const BGLIST_FILE = path.join(DESC_PATH, './list.json');

function decodeHtml(res, charset='utf8') {
  const html = iconv.decode(res, charset);
  return cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false
  });
}

async function loadBGList() {
  const res = await axios(url.resolve(HOST, ENTRY_PATH), {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36'
    }
  })
  return res.data;
}

async function crawlBGList() {
  const listRes = await loadBGList();
  const $ = decodeHtml(listRes);

  const $lis = $('.zhlist li');
  let ret = [];
  $lis.each((i, $li) => {
    const $ps = $('p', $li);

    if ($ps && $ps.length) {
      const $p0 = $ps.eq(0);

      ret.push({
        alias: $p0.text(),
        name: $ps.eq(1).text(),
        url: $('a', $p0).attr('href')
      });
    }
  });

  fs.writeFileSync(BGLIST_FILE, JSON.stringify(ret));
}

if (!fs.existsSync(DESC_PATH)) {
  fs.mkdirSync(DESC_PATH);
}

crawlBGList();