const r = require('rethinkdb');
const axios = require('axios');
const cheerio = require('cheerio');
const {default: inquirer} = require("inquirer");

const connect = () => {
    return new Promise((resolve, reject) => {
        r.connect({host : 'localhost', port : 28015}, (err, conn) => {
            if(err) {
                reject(err);
            } else {
                resolve(conn);
            }
        });
    });
};

const createTableIfNotExists = async (conn) => {
    try {
        if(!conn) {
            throw new Error('연결이 원활하지 않습니다.');
    }

        const tableList = await r.db('test').tableList().run(conn);
        if (!tableList.includes('maple_monster')) {
            console.log('테이블이 존재하지 않아, 테이블을 생성합니다...');
            await r.db('test').tableCreate('maple_monster').run(conn);
            console.log('테이블이 생성되었습니다.');
        }
    } catch (err) {
        console.error('테이블 생성 중 오류 발생:', err);
    }
};

const getMonster = async (url) => {
    try {
        const html = await axios.get(url);
        const $ = cheerio.load(html.data);

        const name = $("aside.portable-infobox").find("[data-source='이름']").text()

        const firstBody = $("section.pi-smart-group-body").first();
        const level = firstBody.find("[data-source='레벨']").text().trim() || "정보 없음";
        const hp = firstBody.find("[data-source='HP']").text().trim() || "정보 없음";

        const result = { name, level, hp };

        return result;


    } catch (error) {
        console.error(error);
    }
};


const insert = async() => {
    const conn = await connect();
    await createTableIfNotExists(conn);
    const answers = await inquirer.prompt([
        {
            type:'input',
            name:'url',
            message:'몬스터 데이터를 가져올 URL을 입력하세요 : '
        }
    ]);
    const {url} = answers;
    const monsterdata = await getMonster(url);
    if(!monsterdata) {
        console.log("데이터 가져오기 실패");
        return;
    }

    const result = await r.db('test').table('maple_monster').insert(monsterdata).run(conn);
    console.log('몬스터 정보가 삽입되었습니다.', result);


}
inquirer.prompt([
    {
        type:'input',
        name:'command',
        message:'>:'
    }
]).then(answers => {
    if(answers.command.toLowerCase() === 'insert') {
        insert();
    }
});

