const express = require('express');
const MyInflux = require('../MyInflux.js');
const request = require("request");
const {toNanoDate} = require('influx'); 

class Progress{
    constructor(from,to){
        this.from = from;   //過去
        this.to = to;       //現在
        this.now = 0;
        this.nowId = 0;
        this.propotion = 0;
        this.data = null;
        this.getCount = 0;
        this.code = 200;
    }
    getPropotion(){
        /*
            進捗パーセントの計算
            取得が昇順か降順かによって処理変わる
            　現在→過去の順
        */
        this.propotion = (Math.round(((this.to.getTime() - this.now.getTime())/(this.to.getTime() - this.from.getTime()))*10000)/100);
        return this.propotion;
    }
}

const influx = new MyInflux('btcfx_mini_executions',[1000],[
    {
        measurement: 'execution',
        fields: {
          id: 'integer',
          price: 'integer',
          size : 'float'
        },
        tags: [
          'type','side'
        ]
    }
],false);

class BfAPI{
    constructor(){
    }
    get endPointUrl(){
        return 'https://api.bitflyer.jp'
    }
    getExecutions(pc='FX_BTC_JPY',count=500,before=0,after=0){
        /*
            before: このパラメータに指定した値より小さい id を持つデータを取得します。
            after: このパラメータに指定した値より大きい id を持つデータを取得します。
        */
        const strBefore = (before === 0) ? '' : `&before=${before}`;
        const strAfter = (after === 0) ? '' : `&after=${after}`; 
        const options ={
            url:`${this.endPointUrl}/v1/executions?product_code=${pc}&count=${count}${strBefore}${strAfter}`,
            method : 'GET',
            headers:{
                "Content-Type" : "application/json"
            },
            json:true
        }
        
        return new Promise((resolve,reject)=>{
            request(options,(error,res,body)=>{
                if(error){
                    console.log(`error is ${error}@getExecutions`);
                    body = {message:'error recieved.'};
                    return reject(error);
                }
                if(res.statusCode != 200) this._outputError(res);
                return resolve([body,res.statusCode]);
            });
        });
    }
    _createSign(timestamp,path,method,body=''){
        //console.log('in createsign body*' + body);
        const text = timestamp + method + path + body; //getはbody空
        const sign = crypto.createHmac('sha256', this.secret).update(text).digest('hex'); //あっち
        return sign;
    }
    _outputError(res){
        console.log('/////////////////////////////////////////////////////////////////////\n');
        console.log(`statusCode ${res.statusCode}@${JSON.stringify(res.request.uri.path)}`);
        console.log(`message ${res.statusMessage}`);
        console.log(JSON.stringify(res));
        console.log('\n/////////////////////////////////////////////////////////////////////');
    }
}
const _asyncSleep = (msec)=>{
    return new Promise(resolve => setTimeout(resolve, msec));
}

const toExNanoString = (n)=>{
    n = Math.round(n);      //少数なら切り捨て
    if(n > 999999){         //7桁以上なら完スト値999999を返す
        return '999999';
    }else if(n < 0){        //マイナスの値なら000000を返す
        return '000000';  
    }else{
    	return ('000000' + n ).slice( -6 );
    }
}


let inProgress = null;
const bf = new BfAPI();

const main = async (mode)=>{
    /*
        つぎは途中から取ってくる
        to : inflxの1番idが大きいやつの時間
        from : 変わらず
        now : influxの1番idが小さいやつの時間

    */
    
    

    //テストコードここから
    //const data = await influx.influx.query(`SELECT * FROM "execution" WHERE time > 1528593571285000001 LIMIT 3`);
    //console.log(data[0].time.getNanoTime());
    //console.log(`////////////////////n/n/n/n`);
    //const date = toNanoDate('1475985480231035600')
    //console.log(date);

    /*
    console.log(`////////////////////n/n/n/n`);
    const nano2 = 1;
    const date2 = toNanoDate(`${(new Date()).getTime() - 1000}${toExNanoString(nano2)}`);   //これだ！
    const nano3 = 2;
    const date3 = toNanoDate(`${(new Date()).getTime() - 1000}${toExNanoString(nano3)}`);   //これだ！

    //INanoDate型でInsertできるのか？
    
    influx.pushData('execution',{
        measurement: 'execution',
        tags: {
            side : `UNKNOWN`,
            type: 'global'
        },
        fields: {
            id : 99999,
            price : 999999,
            size : 0.02
        },
        timestamp: date3
    });

    influx.writeData(true);
    */
    

    //INanoDataでINSERTしたらちゃんとナノ秒で登録されたのでこれでいく
    

    //テストコードここまで

    
    
    if(mode == 'first'){
        const to = new Date();
        const from = new Date(to.getTime() - (1000*60*60*24*30));
        //const from = new Date(to.getTime() - (1000*60*60));
        const nowId = 0;

        const [firstData,code] = await bf.getExecutions('FX_BTC_JPY',500,0,0).catch(async(e)=>{
            console.log(`Get first data is faild. Retry...`);
            await _asyncSleep(5000);
            return [null,100];
        });
        if(firstData === null || code != 200) return main();

        inProgress = new Progress(from,to);
        inProgress.nowId = firstData[0].id;
        inProgress.now = new Date(firstData[0].exec_date+'Z');
        inProgress.data = firstData;
        inProgress.code = 200;
    }else if(mode == 'restart'){
        const toRes = await influx.influx.query(`SELECT MAX("id"),id FROM "execution"`);
        const nowRes = await influx.influx.query(`SELECT MIN("id"),id FROM "execution"`);
        const to = new Date(toRes[0].time);
        const from = new Date(to.getTime() - (1000*60*60*24*100));
        const now = new Date(nowRes[0].time);
        inProgress = new Progress(from,to);
        inProgress.nowId = nowRes[0].id;
        inProgress.now = now;
        inProgress.data = null;
        inProgress.code = 200;
    }else if(mode == 'toNow'){
        const fromRes = await influx.influx.query(`SELECT MAX("id"),id FROM "execution"`);
        const to = new Date();
        const from = new Date(fromRes[0].time);
        const [firstData,code] = await bf.getExecutions('FX_BTC_JPY',500,0,0).catch(async(e)=>{
            console.log(`Get first data is faild. Retry...`);
            await _asyncSleep(5000);
            return [null,100];
        });
        if(firstData === null || code != 200) return main();

        inProgress = new Progress(from,to);
        inProgress.nowId = firstData[0].id;
        inProgress.now = new Date(firstData[0].exec_date+'Z');;
        inProgress.data = firstData;
        inProgress.code = 200;
    }

    while(inProgress.from.getTime() < inProgress.now.getTime()){
        if(inProgress.data !== null  && inProgress.code == 200){
            for(let i=0;i<inProgress.data.length;i=(i+1)|0){
                if(!(inProgress.data[i].side == 'BUY' || inProgress.data[i].side == 'SELL')){
                    console.log(`side is irregular. ${inProgress.data[i].side},id : ${inProgress.data[i].id}`);
                    inProgress.data[i].side = 'UNKNOWN';
                }
                influx.pushData('execution',{
                    measurement: 'execution',
                    tags: {
                        side : inProgress.data[i].side,
                        type: 'global'
                    },
                    fields: {
                        id : inProgress.data[i].id,
                        price : inProgress.data[i].price,
                        size : inProgress.data[i].size
                    },
                    //重複を避けるためにナノ秒にインデックスを追加
                    timestamp: toNanoDate(`${new Date(inProgress.data[i].exec_date+'Z').getTime()}${toExNanoString(i)}`)
                });
                if(inProgress.data[i].id < inProgress.nowId){
                    inProgress.nowId = inProgress.data[i].id;
                    inProgress.now = new Date(inProgress.data[i].exec_date+'Z')
                }
            }
            influx.writeData();
            inProgress.getCount++;
            await _asyncSleep(150);
        }
        [inProgress.data,inProgress.code] = await bf.getExecutions('FX_BTC_JPY',500,inProgress.nowId,0).catch(async(e)=>{
            console.log(`Get first data is faild. Retry...`);
            await _asyncSleep(5000);
            return [null,100];
        });
    }
    
}

module.exports = function(receiveFromAppJs){
    const router = express.Router();
    router.get("/", function(req, res, next){
        console.log('in tester');
        res.render("tester.ejs", {});
    });
    router.get("/get_execution", function(req, res, next){
        inProgress = null;
        main('restart');
        res.send({code : 200});
    });
    router.get("/get_progress", function(req, res, next){
        if(inProgress !== null){
            res.send({
                propotion : inProgress.getPropotion(),
                count : inProgress.getCount,
                code : 200
            });
        }else{
            res.send({
                code : 100
            });
        }
    });
    return router;
};
