require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
const { default: inquirer } = require("inquirer");
const fs = require('fs'); // 파일 시스템 모듈
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const path = require('path');

// MySQL 연결 함수
const connect = async () => {
    return await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
};

// 테이블이 없으면 생성하는 함수
const createTableIfNotExists = async (conn) => {
    try {
        await conn.execute(`
            create table if not exists monster_ (
                id int auto_increment primary key,
                name text not null,
                level int,
                hp int,
                exp int
            )
        `);
    } catch (err) {
        console.error('테이블 생성 중 오류 발생:', err);
    }
};

// HTML에서 특정 정보 파싱
const getMonster = async (url) => {
    try {
        const html = await axios.get(url);
        const $ = cheerio.load(html.data);

        // 새끼야 경험치 넣으라고
        const name = $("aside.portable-infobox").find("[data-source='이름']").text();
        const firstBody = $("section.pi-smart-group-body").first();
        const level = firstBody.find("[data-source='레벨']").text().trim() || "정보 없음";
        const hp = firstBody.find("[data-source='HP']").text().trim() || "정보 없음";
        const exp = firstBody.find("[data-source='EXP']").text().trim() || "정보 없음";

        return { name, level, hp, exp };
    } catch (error) {
        console.error("몬스터 데이터를 가져오는 중 오류 발생:", error);
    }
};

// 몬스터 정보를 텍스트 파일에 저장하는 함수
const saveToFile = (monsterdata) => {
    const filePath = 'monster_data.txt'; // 저장할 파일 경로
    const data = `name: ${monsterdata.name}\nlevel: ${monsterdata.level}\nhp: ${monsterdata.hp}\n exp: ${monsterdata.exp}\n`;

    fs.appendFile(filePath, data, (err) => {
        if (err) {
            console.error("파일 저장 중 오류 발생:", err);
        } else {
            console.log("몬스터 정보가 텍스트 파일에 저장되었습니다.");
        }
    });
};

// 레벨 분포 조회 함수 (30씩 끊어서)
const getLevelDistribution = async (conn) => {
    const [rows] = await conn.execute(`select level from monster_`);
    
    // 레벨 30씩
    const levelDistribution = Array(9).fill(0); // 1~30, 31~60, ..., 241+ 로 나누어짐
    rows.forEach(row => {
        const level = row.level;
        const groupIndex = Math.floor(level / 30);
        if (groupIndex < levelDistribution.length) {
            levelDistribution[groupIndex]++;
        }
    });

    return levelDistribution;
};

// 레벨 분포 한 눈에 보기 쉽게게
const visualizeLevelDistribution = async (levelDistribution) => {
    const width = 800; // 이미지 너비
    const height = 600; // 이미지 높이
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

    const labels = [
        '1-30', '31-60', '61-90', '91-120', '121-150', 
        '151-180', '181-210', '211-240', '241+'
    ];
    const data = levelDistribution;

    const configuration = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '몬스터 레벨 분포',
                data: data,
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: '몬스터 레벨 분포'
                },
                legend: {
                    display: false
                }
            }
        }
    };

    // 이미지 생성
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    const filePath = path.join(__dirname, 'level_distribution.png');
    fs.writeFileSync(filePath, image);
    console.log('-> level_distribution.png');
};

// 몬스터 정보 삽입 함수
const insert = async () => {
    const conn = await connect();
    await createTableIfNotExists(conn);

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'url',
            message: '몬스터 데이터를 가져올 url을 입력하세요: '
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
        `select * from monster_ where name = ?`,
        [monsterdata.name]
    );

    if (existingMonster.length > 0) {
        console.log("이미 데이터베이스에 존재하는 몬스터입니다."); // 데이터 존재 여부
        await conn.end();
        return;
    }

    try {
        await conn.beginTransaction();
        await conn.execute(
            `insert into monster_ (name, level, hp, exp) values (?, ?, ?)`,
            [monsterdata.name, monsterdata.level, monsterdata.hp]
        );
        await conn.commit();
        console.log("몬스터 정보가 삽입되었습니다.");
        
        // 텍스트 파일에도 저장
        saveToFile(monsterdata);

    } catch (err) {
        await conn.rollback();
        console.error("데이터 삽입 중 오류 발생:", err);
    } finally {
        await conn.end();
    }
};

// 레벨 분포를 표시하는 함수
const displayLevelDistribution = async () => {
    const conn = await connect();
    
    try {
        const levelDistribution = await getLevelDistribution(conn);
        await visualizeLevelDistribution(levelDistribution);
    } catch (error) {
        console.error('레벨 분포 시각화 중 오류 발생:', error);
    } finally {
        await conn.end();
    }
};

// 사용자 레벨에 맞는 몬스터 추천 함수
const recommendMonster = async (conn) => {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'level',
            message: '추천하고 싶은 레벨을 입력하세요: ',
            validate: (input) => {
                const level = parseInt(input, 10);
                if (isNaN(level) || level <= 0) {
                    return '유효한 레벨을 입력하세요.';
                }
                return true;
            }
        }
    ]);

    const level = parseInt(answers.level, 10);

    // 해당 레벨에 맞는 몬스터를 조회 (레벨 +- 5로 설정)
    const [monsters] = await conn.execute(
        `SELECT * FROM monster_ WHERE level BETWEEN ? AND ?`,
        [level - 5, level + 5]
    );

    if (monsters.length === 0) {
        console.log("해당 레벨에 맞는 몬스터가 없습니다.");
    } else {
        console.log(`레벨 ${level}에 맞는 몬스터 추천:`);
        monsters.forEach(monster => {
            console.log(`- ${monster.name} (Level: ${monster.level}, HP: ${monster.hp}, , EXP: ${monster.exp})`);
        });
    }
};

// 사용자 입력 받기
inquirer.prompt([
    {
        type: 'input',
        name: 'command',
        message: '>:' 
    }
]).then(answers => {
    const conn = connect();

    if (answers.command.toLowerCase() === 'insert') {
        insert();
    } else if (answers.command.toLowerCase() === 'visual') {
        displayLevelDistribution();
    } else if (answers.command.toLowerCase() === 'recommend') {
        recommendMonster(conn);
    }
});
