const Influx = require("influx");


//データベースへの登録、登録するデータのキューを管理するクラス

/*
    フィールドの初期化とデータ登録の例
    new MyInflux(DB名,[各フィールドのキューの保持数（ここで設定した個数以上になったらDBに登録)],[フィールド達])
    fieldsの各値には型を指定する
    詳細はhttps://www.npmjs.com/package/influx
    
    this.influx = new MyInflux('btcfx_mini_master',[5,5],[
        {
            measurement: 'methods_parameter',
            fields: {
                boardVolumeBuy: 'float',
                boardVolumeSell: 'float',
                last_ltvd: 'float',
                ltvd_ave: 'float',
                late_ltvd_ave: 'float',
                judge_value: 'float',
                pos_sigma: 'integer',
                neg_sigma: 'integer',
                ltvd_pos_sigma : 'float',
                ltvd_neg_sigma : 'float',
                ltpAve: 'integer',
                total_profit: 'integer'
            },
            tags: [
                't','sigma','type'
            ]
        },
        {
            measurement: 'execution_volume',
            fields: {
                execVolumeBuy: 'float',
                execVolumeSell: 'float',
                bsSum: 'float'
            },
            tags: [
                'type'
            ]
        }
    ]);



    this.influx.pushData('methods_parameter',{
        measurement: 'methods_parameter',
        tags: {
            t : this.t,
            sigma : this.nsigma,
            type: 'local'
        },
        fields: {
            boardVolumeBuy: this.boardVolumeBuy,
            boardVolumeSell: this.boardVolumeSell,
            last_ltvd: this.ltvd[this.ltvd.length-1].vol,
            ltvd_ave: this.ltvdAve/global.ROUND_DIGITS,
            late_ltvd_ave: this.ltvdLateSigmas[0].ave,
            judge_value: this.judgeValue,
            pos_sigma: this.ltpPosSigma,
            neg_sigma: this.ltpNegSigma,
            ltvd_pos_sigma : this.ltvdPosSigma,
            ltvd_neg_sigma : this.ltvdNegSigma,
            ltpAve : this.ltpAve,
            total_profit: market.updateNowProfit()
        },
        timestamp: new Date()  
    });

*/

class MyInflux{
    constructor(dbName,writeLength,mySchema,isWrite = true){
        this.isWrite = isWrite;
        //console.log(JSON.stringify(mySchema));
        for(let v in mySchema){
            for(let w in mySchema[v].fields){
                switch(mySchema[v].fields[w]){
                    case 'integer' : 
                        mySchema[v].fields[w] = Influx.FieldType.INTEGER;
                        break;
                    case 'float' : 
                        mySchema[v].fields[w] = Influx.FieldType.FLOAT;
                        break;
                    case 'string' :
                        mySchema[v].fields[w] = Influx.FieldType.STRING;
                        break;
                }
            }
        }
        this.influx = new Influx.InfluxDB({
            host: 'localhost',
            database : dbName,
            schema: mySchema
        });
        this.ipData = {};
        for(let v in mySchema){
            this.ipData[mySchema[v].measurement] = {
                data:new Array(),
                writeLength : writeLength[v],
                laptime : 0,
                name : mySchema[v].measurement
            }
            console.log(`mySchema[${v}].measurement is ${mySchema[v].measurement}`);
            console.log(JSON.stringify(this.ipData[mySchema[v].measurement]));
        }
        this.checkPing();   
    }
    checkPing(){
        this.influx.ping(5000).then(hosts => {
            hosts.forEach(host => {
              if (host.online) {
                console.log(`${host.url.host} responded in ${host.rtt}ms running ${host.version}. DBに繋がったよ！`)
              } else {
                console.log(`${host.url.host} is offline :( おかしいなDBにつながらない・・・`)
              }
            })
        });
    }
    writeData(mustWrite = false){
        if(mustWrite){
            //キューの個数にかかわらずすべて登録
            for(let p in this.ipData){
                this.ipData[p].laptime = Date.now();
                this.influx.writePoints(this.ipData[p].data).then(()=>{
                    console.log(`Writed to influx DB. Mesurement:${this.ipData[p].name} Laptime:${Date.now()-this.ipData[p].laptime}, Record length:${this.ipData[p].data.length}`);
                    this.ipData[p].data.length = 0;
                }).catch((err)=>{
                    console.log(`influx write data faild. Message:${err}`);
                });
            }
        }else{
            //キューの個数が上限値を超えていたらDBに登録
            for(let p in this.ipData){
                if(this.ipData[p].data.length > this.ipData[p].writeLength){
                    this.ipData[p].laptime = Date.now();
                    this.influx.writePoints(this.ipData[p].data).then(()=>{
                        //console.log(`Writed to influx DB. Mesurement:${this.ipData[p].name}, Laptime:${Date.now()-this.ipData[p].laptime}, Record length:${this.ipData[p].data.length}`);
                        this.ipData[p].data.length = 0;
                    }).catch((err)=>{
                        console.log(`influx write data faild. Message:${err}`);
                    });
                }
            }
        }
    }
    pushData(msName,myData){
        this.ipData[msName].data.push(myData);
        if(this.isWrite) this.writeData();
    }
}


module.exports = MyInflux;