
//websocketで送られてくる最新の約定履歴や最終取引価格、板情報を整形・保持するクラス

global.gBestAsk = 0;
global.gBestBid = 0;


const BfAPI = require("./BfAPI.js");
const MyInflux = require("./MyInflux.js");
const WebSocket = require("rpc-websockets").Client;

class TakerOrder{
    constructor(side,vol,stamp){
        this.side = side;
        this.vol = vol;
        this.stamp = stamp;
    }
}
class TradedPrice{
    constructor(price,stamp){
        this.price = price;
        this.stamp = stamp;
    }
}


class RealtimeBoard{
    constructor(retainMaxTime){
        this.ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");
        this.ws.on("open", ()=>{
            this.stateWsOpen = true;
            console.log(`ws opend`);
            this.wsSubscribe();
            this.stateAvailable = false;
        });
        
        this.bf = new BfAPI();

        //データベース用フィールドの初期化
        this.influx = new MyInflux('btcfx_mini_master',[100],[{
            measurement: 'ticker',
            fields: {
                best_ask: 'integer',
                best_bid: 'integer',
                sfd : 'float',
                best_ask_MA10 : 'integer',
                best_bid_MA10 : 'integer',
                //sfd_MA10: 'float',
                posSigma : 'integer',
                negSigma : 'integer'
            },
            tags: [
                'type'
            ]
        }]);
        
        //最終取引価格に関する変数達　
        //値動きのボラリティや現物価格との乖離率等
        this.lastPrice = 0;
        this.bestAsk = 0;
        this.bestBid = 0;
        this.bestAskMA10s = 0;
        this.bestBidMA10s = 0;
        this.lastStockPrice = 0;
        this.lastSfd = 0;
        this.tickLtp = 0;
        this.sfdsMA10s = 0;
        this.bestAsks = new Array();
        this.bestBids = new Array();
        this.sfds = new Array();
        this.trueMidPrices = new Array();
        this.longMidPrices = new Array();
        this.retainMaxTimeLong = 1000 * 60 * 5;
        this.negSigma = 0;
        this.posSigma = 0;
        this.nsigma = 3;
        this.tLtpAve = 0;

        //板情報
        this.buyBoard = new Array();
        this.sellBoard = new Array();

        //約定履歴
        this.executions = new Array();

        //自身の最終更新日時 contoroller側でのwssの死活管理に使用する
        this.lastUpdateTime = Date.now();

        this.retainMaxTime = retainMaxTime;

        //wssで受信するチャンネル一覧
        this.channels = {
            fxExe :'lightning_executions_FX_BTC_JPY',
            fxBdSnap : 'lightning_board_snapshot_FX_BTC_JPY',
            fxBd : 'lightning_board_FX_BTC_JPY',
            fxTick : 'lightning_ticker_FX_BTC_JPY',
            acTick : 'lightning_ticker_BTC_JPY'
        }

        //データ貯めてる最中？　まだ全部貯まっていないときはtrue 貯まったらfalse
        this.stateAccumulating = true;
        this.stateWsOn = false;

        //約定履歴を合計する時間単位
        this.EXEC_RETENTION_TIME = 9000;  
        
        //wssの板情報の最高価格と最低価格
        this.boardSnapMaxPrice = 0;
        this.boardSnapMinPrice = 0; 

        console.log('RealtimeBoard is Constructed.[in RealtimeBoard constructor]');
    }

    //受信したmessageのchannelに応じた処理
    updateSomething(notify){
        this.lastUpdateTime = Date.now();
        switch(notify.channel){

            //約定履歴が来た場合
            case this.channels.fxExe :

                //配列executionsは約定時刻順に整列されている(末尾が最新)
                //EXEC_RETANTION_TIME[ms]間の約定履歴を保持している

                //受信する約定履歴は最新とは限らないため、executionsの所定の位置に挿入する
                for(let value of notify.message){
                    const execDate = new Date(value.exec_date);
                    let i = 0;
                    //末尾から探索
                    for(i=this.executions.length-1;i >= 0;i=(i-1)|0){
                        if(this.executions[i].stamp.getTime() < execDate.getTime()){
                            this.executions.splice(i+1,0, new TakerOrder(value.side,value.size,execDate));
                            break;
                        }   
                    }

                    //executionsのどれよりもタイムスタンプが古かった場合配列先頭に挿入
                    if(i < 0) this.executions.unshift(new TakerOrder(value.side,value.size,execDate));

                    if(this.executions.length == 0){
                        this.executions.push(new TakerOrder(value.side,value.size,execDate));
                        continue;
                    }
                }

                //配列先頭のstampが古かったら取り除く
                const lastTime = this.executions[this.executions.length-1].stamp.getTime();
                while(1){
                    if(lastTime - this.executions[0].stamp.getTime() > this.EXEC_RETENTION_TIME){
                        this.executions.shift();
                    }else{
                        break;
                    }
                }
                
                //console.log(`Update execution is done. [in RealtimeBoard updateSomething]`);
                break;
            //end of case
            
            
            //板情報スナップが来た場合
            case this.channels.fxBdSnap :
                //console.log(`Update snapboard is start. [in RealtimeBoard updateSomething]`);
                //console.log(JSON.stringify(notify));
                
                this.updateBoardAll(notify.message);
                            
                //console.log(`Update snapboard is done. [in RealtimeBoard updateSomething]`);
                break;
            
            //end of case
            


            //板情報差分が来た場合
            case this.channels.fxBd :

                this.lastPrice = notify.message.mid_price;
                //console.log(`Update execution is done. [in RealtimeBoard updateSomething]`);
                
                /*
                    buyBoard,sellBoardの仕様
                    ・添字自体がpriceを表す
                    ・buy(sell)Board[price]の値がそのpriceの数量

                    板情報差分の仕様
                    ・https://lightning.bitflyer.com/docs#%E6%9D%BF%E6%83%85%E5%A0%B1%E3%81%AE%E5%B7%AE%E5%88%86
                        
                        板の注文に更新があった場合、その差分情報を配信します。 以下のレスポンスは、33,350 円の bid 注文が更新され、
                        その合計数量が 1 BTC になっていることを示します。

                            {
                            mid_price: 35625,
                            bids: [
                                {
                                price: 33350,
                                size: 1
                                }
                            ],
                            asks: []
                            }

                        注文が約定・キャンセル等で板から消えた場合、size が 0 のものが配信されます。
                */

                //板情報差分処理
                for(let value of notify.message.bids){
                    if(value.price < this.boardSnapMinPrice) continue;
                    if(value.size === 0){
                        if(this.buyBoard[value.price]){
                            delete this.buyBoard[value.price];
                            continue;
                        }else{
                            //存在しないはずは無いが念のため。
                            //console.log(`存在しないpriceを削除しようとした！@buy ${value.price} mid:${this.lastPrice}`);
                        }
                    }else{
                        //midPriceより大きい？（ありえないはずだけど念のため）
                        if(value.price > this.lastPrice){
                            console.log('lpより大きいよ！'); 
                            continue;
                        }
                        this.buyBoard[value.price] = value.size;
                    }
                }
                for(let value of notify.message.asks){
                    if(value.price > this.boardSnapMaxPrice) continue;
                    if(value.size === 0){
                        if(this.sellBoard[value.price]){
                            delete this.sellBoard[value.price];
                            //console.log('削除したよ！@sell');
                            continue;
                        }else{
                            //存在しないはずは無いが念のため。
                            //console.log(`存在しないpriceを削除しようとした！@sell ${value.price} mid:${this.lastPrice}`);
                        }
                    }else{
                        //1.midPriceより小さい？（ありえないはずだけど念のため）
                        if(value.price < this.lastPrice){
                            console.log('lpより小さいよ！');
                            continue;
                        } 
                        this.sellBoard[value.price] = value.size;
                    }
                }
                break;
            case this.channels.fxTick :
                /*
                レスポンス
                {
                    "product_code": "BTC_JPY",
                    "timestamp": "2015-07-08T02:50:59.97",
                    "tick_id": 3579,
                    "best_bid": 30000,
                    "best_ask": 36640,
                    "best_bid_size": 0.1,
                    "best_ask_size": 5,
                    "total_bid_depth": 15.13,
                    "total_ask_depth": 20,
                    "ltp": 31690,
                    "volume": 16819.26,
                    "volume_by_product": 6819.26
                }
                */
            
                const priceTimeStamp = Date.now();
                this.tickLtp = notify.message.ltp;

                //現物とFXの価格乖離率 sfdの計算
                if(this.lastStockPrice == 0){
                    this.sfd = 0;
                }else{
                    this.sfd = (this.tickLtp/this.lastStockPrice)*100 - 100;
                }
                global.sfd = this.sfd;
                this.sfds.push(new TradedPrice(this.sfd,priceTimeStamp));


                const ba = notify.message.best_ask;
                const bb = notify.message.best_bid

                this.bestAsks.push(new TradedPrice(ba,priceTimeStamp));
                this.bestAsk = ba;
                global.gBestAsk = ba;

                this.bestBids.push(new TradedPrice(bb,priceTimeStamp));
                this.bestBid = bb;
                global.gBestBid = bb;

                
                const mp = Math.round((ba+bb)/2)
                this.trueMidPrices.push(new TradedPrice(mp,priceTimeStamp));
                this.longMidPrices.push(new TradedPrice(mp,priceTimeStamp));

                //古いprice等をシフト
                while(1){
                    if( this.bestAsks[this.bestAsks.length-1].stamp - this.bestAsks[0].stamp > this.retainMaxTime){
                        this.bestAsks.shift();
                        this.bestBids.shift();
                        this.trueMidPrices.shift();
                        this.sfds.shift();
                        this.stateAccumulating = false;
                    }else{
                        break;
                    }
                }

                while(1){
                    if( this.longMidPrices[this.longMidPrices.length-1].stamp - this.longMidPrices[0].stamp > this.retainMaxTimeLong){
                        this.longMidPrices.shift();
                        this.stateAccumulating = false;
                    }else{
                        break;
                    }
                }
                
                //移動平均とσを求める
                //平均、sigmaはインライン化
                if(this.longMidPrices.length > 100){
                    let tempLtpAve = 0;
                    for(let i=0;i<this.longMidPrices.length;i=(i+1)|0) tempLtpAve = tempLtpAve + this.longMidPrices[i].price;
                    
                    this.tLtpAve = Math.round(tempLtpAve/this.longMidPrices.length);

                    //Σ(xi-xave)^2の計算//n-1で割ってルート.
                    let sigma = 0;
                    for(let i=0;i<this.longMidPrices.length;i=(i+1)|0) sigma = sigma + ((this.longMidPrices[i].price - this.tLtpAve) ** 2);
                    
                    sigma = Math.round(Math.sqrt(sigma/(this.longMidPrices.length-1)));


                    //lastPrice ± nσ
                    this.posSigma = Math.round(this.tLtpAve + ((sigma * (this.nsigma*10))/10));
                    this.negSigma = Math.round(this.tLtpAve - ((sigma * (this.nsigma*10))/10));

                    global.tLtpAve = this.tLtpAve;
                    global.posSigma = this.posSigma;
                    global.negSigma = this.negSigma;
                }else{
                    this.tLtpAve = this.trueMidPrices[this.trueMidPrices.length-1].price;
                    
                    //サンプル貯まるまではsigmaの値暫定とする
                    this.posSigma = this.trueMidPrices[this.trueMidPrices.length-1].price + 1000;
                    this.negSigma = this.trueMidPrices[this.trueMidPrices.length-1].price - 1000;                    
                }


                if(this.bestAsks.length > 3){

                    //Ask,Bid 10秒移動平均求める
                    let pCount = 1|0;
                    let bestAskAve = this.bestAsks[this.bestAsks.length - 1].price;
                    let bestBidAve = this.bestBids[this.bestBids.length - 1].price;
                    //let sfdsAve = this.sfds[this.sfds.length - 1].price;
                    let ti = (this.bestAsks.length - 2)|0;
                    while(ti >= 0 && this.bestAsks[ti].stamp > this.bestAsks[this.bestAsks.length - 1].stamp - 10000){
                        bestAskAve += this.bestAsks[ti].price;
                        bestBidAve += this.bestBids[ti].price;
                        //sfdsAve += this.sfds[ti].price * 100;
                        pCount = (pCount + 1)|0;
                        ti = (ti - 1)|0;
                    }
                    this.bestAskMA10s = Math.round(bestAskAve/pCount);
                    this.bestBidMA10s = Math.round(bestBidAve/pCount);
                    //this.sfdsMA10s = (Math.round(sfdsAve/pCount))/100;

                    
                    //this.influx.pushTicker(this.bestAsk,this.bestBid,this.bestAskMA10s,this.bestBidMA10s,new Date());
                    this.influx.pushData('ticker',{
                        measurement: 'ticker',
                        tags: {
                            type: 'global'
                        },
                        fields: {
                        best_ask: this.bestAsk,
                        best_bid: this.bestBid,
                        sfd : this.sfd,
                        best_ask_MA10 : this.bestAskMA10s,
                        best_bid_MA10 : this.bestAskMA10s,
                        //sfd_MA10 : this.sfdsMA10s,
                        posSigma : this.posSigma,
                        negSigma : this.negSigma
                        },
                        timestamp: new Date()
                    });
                }                
                break;
            //end of case
            case this.channels.acTick :
                this.lastStockPrice = notify.message.ltp;
                break;
            //end of case
        }
    }

    //板スナップをもとに板情報をまるまる更新する処理
    updateBoardAll(mes){
        //console.time('mes');
        
        //板更新中は外部から自身のデータにアクセスできないようにする
        this.stateAvailable = false;

        this.buyBoard.length = 0;
        this.sellBoard.length = 0;
        this.lastPrice = mes.mid_price;
        this.boardSnapMaxPrice = -99999999999;
        this.boardSnapMinPrice = 99999999999;


        //asksが売り、bidsが買い
        //sellBoardの添字は mid_price から　length  まで mid_price未満はemptyのはず
        for(let value of mes.asks){
            this.sellBoard[value.price] = value.size;
            if(this.boardSnapMaxPrice < value.price){
                this.boardSnapMaxPrice = value.price;
            }
        }

        //buyBoardの添字は0からmid_priceまでmid_priceより上はemptyのはず
        for(let value of mes.bids){
            this.buyBoard[value.price] = value.size;
            if(this.boardSnapMinPrice > value.price){
                this.boardSnapMinPrice = value.price;
            }
        }
        
        //1番最初の板スナップ取得の場合mid_priceをbestAsk,bestBidにpush
        if(this.bestAsks.length == 0){
            let tm = Date.now();
            this.bestAsks.push(new TradedPrice(mes.mid_price,tm));
            this.bestBids.push(new TradedPrice(mes.mid_price,tm));
        }
        
        this.stateAvailable = true;
        //console.timeEnd('updateBoardAll');
        //console.log('Finish updateBoardAll. [in RealtimeBoard updateBoardAll]');
    }
    stopUpdate(){
        this.wsUnSubscribe();
    }
    restartUpdate(){
        this.wsSubscribe();
    }
    wsSubscribe(){
        if(this.stateWsOpen){
            for(let v in this.channels){
                this.ws.call("subscribe", {
                    channel: this.channels[v]
                });
                //console.log(this.channels[v]);
            }
        }
        
        this.ws.on("channelMessage", notify => {
            //console.log('getNotify');
            this.updateSomething(notify);
        });
        console.log('ws subscribe. ');
        this.stateWsOn = true;
    }
    wsUnSubscribe(){
        if(this.stateWsOn){
            for(let v in this.channels){
                this.ws.call("unsubscribe", {
                    channel: this.channels[v]
                });
            }
            this.stateWsOn = false;
        }
    }
}

module.exports = RealtimeBoard;
