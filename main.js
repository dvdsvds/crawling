require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
const { default: inquirer } = require("inquirer");

const connect = async () => {
    return await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
};

const createTableIfNotExists = async (conn) => {
    try {
        await conn.execute(`
            create table if not exists monster (
                id int auto_increment primary key,
                name text not null,
                level int,
                hp int
            )
        `);
    } catch (err) {
        console.error('테이블 생성 중 오류 발생:', err);
    }
};

const getMonster = async (url) => {
    try {
        const html = await axios.get(url);
        const $ = cheerio.load(html.data);

        const name = $("aside.portable-infobox").find("[data-source='이름']").text();
        const firstBody = $("section.pi-smart-group-body").first();
        const level = firstBody.find("[data-source='레벨']").text().trim() || "정보 없음";
        const hp = firstBody.find("[data-source='HP']").text().trim() || "정보 없음";

        return { name, level, hp };
    } catch (error) {
        console.error("몬스터 데이터를 가져오는 중 오류 발생:", error);
    }
};

const insert = async () => {
    const conn = await connect();
    await createTableIfNotExists(conn);

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'url',
            message: '몬스터 데이터를 가져올 URL을 입력하세요: '
        }
    ]);

    const { url } = answers;
    const monsterdata = await getMonster(url);

    if (!monsterdata) {
        console.log("데이터 가져오기 실패");
        return;
    }

    // 이미 데이터베이스에 해당 몬스터가 존재하는지 확인
    const [existingMonster] = await conn.execute(
        `SELECT * FROM maple_monster WHERE name = ?`,
        [monsterdata.name]
    );

    if (existingMonster.length > 0) {
        console.log("이미 데이터베이스에 존재하는 몬스터입니다.");
        await conn.end();
        return;
    }

    try {
        await conn.beginTransaction();
        await conn.execute(
            `INSERT INTO maple_monster (name, level, hp) VALUES (?, ?, ?)`,
            [monsterdata.name, monsterdata.level, monsterdata.hp]
        );
        await conn.commit();
        console.log("몬스터 정보가 삽입되었습니다.");
    } catch (err) {
        await conn.rollback();
        console.error("데이터 삽입 중 오류 발생:", err);
    } finally {
        await conn.end();
    }
};

inquirer.prompt([
    {
        type: 'input',
        name: 'command',
        message: '>:'
    }
]).then(answers => {
    if (answers.command.toLowerCase() === 'insert') {
        insert();
    }
});
