
const MyOrder = require('./MyOrder.js');
const BfWeb = require('./BfWeb_v02.js');
const BfAPI = require("./BfAPI.js");
const MyInflux = require("./MyInflux.js");

//取引所とのやり取り及び取引所側のポジションを管理するクラス

class Market extends MyOrder{
    constructor(isMaster,orderVol){
        super(orderVol);
        this.orderSizeHalf = orderVol;
        this.orderSize = ((orderVol * global.ROUND_DIGITS_MIN)*2)/global.ROUND_DIGITS_MIN;

        this.stateOrderMonitoring = false;      //注文監視モード
        this.stateProcessing = false;           //処理中モード
        this.stateUnknownOrder = true;          //インスタンス作ってまだ1度も注文してない場合はTrue
        this.stateProfitDetermination = false;  //ポジションクローズモード
        this.stateMasterPermission = false;     //controller側のorder許可
        this.stateRunningSfd = false;           //sfd手数料徴収される領域かどうか

        if(isMaster){
            this.bf = new BfWeb(this.orderSizeHalf,-this.orderSizeHalf);
            this.bf.initWindow();
            this.pastTime = Date.now();
            this.influx = new MyInflux(
                'btcfx_mini_master',
                [5],
                [
                    {
                      measurement: 'order',
                      fields: {
                        position_flag : 'integer',
                        position_str : 'string',
                        market_health : 'string',
                        delay : 'integer'
                      },
                      tags: [
                        't','sigma','type','market_health','position_str'
                      ]
                    }
                ]
            );
        }else{
            console.log('in market not master.(Not compatible.)');
        }

        this.isMaster = isMaster;

        this.latestOrderSide = 'NP;'
        this.latestOrderSideHope = 'NP';
        this.latestOrderSize = 0;
        this.latestOrderSizeHope = 0;

        this.laptime = 0;
        this.latestOrderTime = 0;

        Market.updateMarketState();
    }
    //取引所クラスに注文リクエストを送り注文完了するまで見守る処理
    //メソッド側のポジションが更新されたら呼び出される。
    updateMarketOrder(reqSide,sigma,t){
        
        /*
            メソッドとマーケットのポジが異なる  かつ
            注文監視モードでない            かつ
            注文中モードでない              かつ
            処理中でない                  かつ
            最後のオーダーから3秒以上経ってる  かつ
            マーケットの状態が注文可能        なら
        */
        if(reqSide != this.side &&
            !this.stateOrderMonitoring &&
            !this.stateProcessing &&
            Market.prototype.stateMarket &&
            Date.now() - this.latestOrderTime > 3000 &&
            this.stateMasterPermission
            ){
            this.stateProcessing = true;
            
            /*
                メソッドからのリクエストサイド : reqSide
                現在のマーケットのサイド : this.side
                
                に対する

                オーダーするサイズ : orderSizeHope
                オーダーするサイド : orderSideHope
                
                の対応表

                reqSide         this.side |  orderSizeHope       orderSideHope
                -----------     --------- |  -------------       -------------
                BUY             SELL      |  this.orderSize         BUY
                BUY             NP        |  this.orderSizeHalf     BUY
                SELL            BUY       |  this.orderSize         SELL
                SELL            NP        |  this.orderSizeHalf     SELL
                NP              BUY       |  this.orderSizeHalf     SELL
                NP              SELL      |  this.orderSizeHalf     BUY
            */

            //上記対応表をコード化したもの
            if(this.stateRunningSfd){
                if(this.side == 'NP' && reqSide == 'BUY'){
                    this.stateProcessing = false;
                    return 0;
                }
                this.latestOrderSizeHope = this.orderSizeHalf;
                if(reqSide == 'SELL'){
                    this.latestOrderSideHope = 'SELL';
                    this.stateProfitDetermination = false;
                }else if(reqSide == 'BUY' || reqSide == 'NP'){
                    this.latestOrderSideHope = 'BUY';
                    this.stateProfitDetermination = true;
                }
            
            }else{
                if(reqSide == 'NP'){
                    this.latestOrderSizeHope = this.orderSizeHalf;
                    this.stateProfitDetermination = true;
                    if(this.side == 'BUY'){
                        this.latestOrderSideHope = 'SELL';
                    }else if(this.side == 'SELL'){
                        this.latestOrderSideHope = 'BUY';
                    }
                }else if(reqSide == 'BUY'){
                    this.stateProfitDetermination = false;
                    this.latestOrderSideHope = 'BUY';
                    if(this.side == 'SELL'){
                        this.latestOrderSizeHope = this.orderSize;
                    }else if(this.side == 'NP'){
                        this.latestOrderSizeHope = this.orderSizeHalf;
                    }
                }else if(reqSide == 'SELL'){
                    this.stateProfitDetermination = false;
                    this.latestOrderSideHope = 'SELL';
                    if(this.side == 'BUY'){
                        this.latestOrderSizeHope = this.orderSize;
                    }else if(this.side == 'NP'){
                        this.latestOrderSizeHope = this.orderSizeHalf;
                    }
                }    
            }
            
            
            this.stateOrderMonitoring = true;
            this.laptime = Date.now();
            this.latestOrderTime = Date.now();
            //console.time(`order σ:${sigma}, t:${t/1000}`);
            
            
            this.bf.pushOrder(this.latestOrderSideHope,this.latestOrderSizeHope,this.laptime,(res)=>{
                if(res.code == 200){
                    this.latestOrderSide = this.latestOrderSideHope;
                    this.latestOrderSize = this.latestOrderSizeHope;
                    //console.timeEnd(`order σ:${sigma}, t:${t/1000}`);
                    //console.log(`σ:${sigma}, t:${t} の注文が約定したよ！ 注文->約定までの時間 : ${Date.now() - this.laptime}[ms]`);

                    const dt = Date.now() - this.laptime;

                    let sideStr = '';

                    //ノーポジ : 0,  買い : 1,  売り : -1 
                    let sideNumber = 0;

                    //ポジションクローズモードなら
                    if(this.stateProfitDetermination){
                        sideStr = 'NP';
                        sideNumber = 0;
                    }else{
                        sideStr = this.latestOrderSide;
                        if(sideStr == 'SELL'){
                            sideNumber = -1;
                        }else if(sideStr == 'BUY'){
                            sideNumber = 1;
                        }
                    }
                    this.influx.pushData('order',{
                        measurement: 'order',
                        tags: {
                            t : t,
                            sigma : sigma,
                            type: 'local',
                            market_health: Market.prototype.marketHealth,
                            position_str: sideStr
                        },
                        fields: {
                            position_flag : sideNumber,
                            position_str : sideStr,
                            market_health : Market.prototype.marketHealth,
                            delay : dt
                        },
                        timestamp : new Date()
                    });
                    
                    console.log(`ask : ${global.gBestAsk},bid : ${global.gBestBid}`);

                    //ここでのNPの注文したかどうかはstateProfitDeterminationで判断
                    if(this.stateProfitDetermination){
                        //NPの注文（持ってたポジションをクローズ）した場合
                        if(this.latestOrderSideHope == 'BUY'){
                            super.updateOrder('NP',global.gBestAsk);
                        }else if(this.latestOrderSideHope == 'SELL'){
                            super.updateOrder('NP',global.gBestBid);
                        }
                    }else{
                        if(this.latestOrderSideHope == 'BUY'){
                            super.updateOrder('BUY',global.gBestAsk);
                        }else if(this.latestOrderSideHope == 'SELL'){
                            super.updateOrder('SELL',global.gBestBid);
                        }
                    }
                    
                    this.stateOrderMonitoring = false;
                    this.stateUnknownOrder = false;
                    this.stateProcessing = false;
                }else{
                    console.log(`order is faild? res.code is ${res.code}`);
                    this.stateOrderMonitoring = false;
                    this.stateProcessing = false;
                }
            });  
        }
    }

    //取引所APIから取引所の状態を取得
    static updateMarketState(){
        Market.prototype.staticBfAPI.getBoardState('FX_BTC_JPY',(error,res,body,code)=>{
            if(code == 200){
                Market.prototype.marketHealth = body.health;
                Market.prototype.marketState = body.state;
            }else{
                Market.prototype.marketHealth = 'UNKNOWN';
                Market.prototype.marketState = 'UNKNOWN';
            }
            if((
                Market.prototype.marketHealth == 'NORMAL' ||
                Market.prototype.marketHealth == 'BUSY' ||
                Market.prototype.marketHealth == 'VERY BUSY' ||
                Market.prototype.marketHealth == 'SUPER BUSY' 
            )&&(
                Market.prototype.marketState == 'RUNNING'
            )){
                Market.prototype.stateMarket = true;
            }else{
                Market.prototype.stateMarket = false;
            }    
        });
    }
}
Market.prototype.marketHealth = 'UNKNOWN';          //取引所の稼動状態
Market.prototype.marketState = 'UNKNOWN';           //板の状態
Market.prototype.stateMarket = false;               //取引所の稼動状態と板の状態から発注可能かどうか判断
Market.prototype.updateMarketStateInterval = 1000;  //取引所の状態を更新する間隔[ms]
Market.prototype.staticBfAPI = new BfAPI();




module.exports = Market;