//小数誤差収めるための倍数
global.ROUND_DIGITS = 1000000;
global.ROUND_DIGITS_MIN = 1000;

global.asyncSleep = (msec)=>{
    return new Promise(resolve => setTimeout(resolve, msec));
}

global.dateFormat = {
    fmt : {
      "yyyy": (date)=>date.getFullYear() + '',
      "MM": (date)=>('0' + (date.getMonth() + 1)).slice(-2),
      "dd": (date)=>('0' + date.getDate()).slice(-2),
      "hh": (date)=>('0' + date.getHours()).slice(-2),
      "mm": (date)=>('0' + date.getMinutes()).slice(-2),
      "ss": (date)=>('0' + date.getSeconds()).slice(-2)
    },
    format:function dateFormat(date, format){
      var result = format;
      for (var key in this.fmt)
        result = result.replace(key, this.fmt[key](date));
      return result;
    }
};

const express = require('express');
const RealtimeBoard = require('../RealtimeBoardWSS_rls.js');
const Method = require('../MyFourthMethod.js');
const Market = require('../Market.js');
const MyTwitter = require("../MyTwitter.js");





class Bot{
    constructor(){
        this.twitter = new MyTwitter();

        //何[ms]毎に売買判定を行うか
        this.loopInterval = 1200;

        //売買判定ロジックの定数
        this.sigma = 2.5;
        this.t = 136000;

        //これいるか・・・？
        this.startInterval = this.t + 2000;

        //ビットコイン注文枚数
        this.orderSize = 0.02;
        this.orderSizeHalf = 0.01;

        this.board = new RealtimeBoard(this.startInterval);
        this.method = new Method(this.t,this.sigma,-1,this.orderSizeHalf,true);
        this.market = new Market(true,this.orderSizeHalf);

        //コントロールページに表示させる状態の初期値
        //赤、黃、緑色のLEDランプを模した表示で状態を示す
        this.statuses = {
            marketMasterPermission:     {status:'red',text:'Master Permission'},
            websocket :                 {status:'red',text:'WebSocket'},
            outOfRange:                 {status:'red',text:'Out of Range'},
            //API :                     {status:'red',text:'REST API'},
            method :                    {status:'red',text:'Method'},
            marketHealth :              {status:'red',text:'Market Health'},
            marketOrderMonitering :     {status:'red',text:'In Order'},
            marketWeb :                 {status:'red',text:'Market Web'},
            inOrderPushButton :         {status:'yellow',text:'Pushed Button'},
            inOrderCompleteOrder :      {status:'yellow',text:'Complete Order'},
            inOrderCompleteExecution :  {status:'yellow',text:'Complete Execution'},
            inOrderUnaccountedOrder :   {status:'yellow',text:'Unaccounted Order'}
        } 
    }
    start(){
        this.market.stateMasterPermission = true;
        //console.log('switching masterPermission is prohibited.')
    }
    stop(){
        this.market.stateMasterPermission = false;
        console.log('ポジションが残っている場合、手動でクローズしてください。');
    }
    async loopTask(){

        //取引所の最新の状態を取得（注文可能かどうか、鯖落ちしてないか）
        Market.updateMarketState();

        this.method.judgment(this.board,this.market);

        //websocketが受信できていない場合メッセージ吐いて再接続
        if(Date.now() - this.board.lastUpdateTime > 20000){
            console.log('websocket is freeze? re subscribe');
            this.twitter.sendDM(`[${dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] websocketが受信できていないよ！`);
            this.board.wsUnSubscribe();
            await global.asyncSleep(2000);
            this.board.wsSubscribe();
        }
        
        //フリーズチェック死活管理（取引ページがバグった場合取引ページのフリーズチェック自体が止まる場合がある・・・）
        if(this.market.bf.freezeCheckLastUpdateTime !== null && Date.now() - this.market.bf.freezeCheckLastUpdateTime > this.market.bf.CHECK_FREEZE_INTERVAL * 2 + 1000){
            this.market.bf.checkFreeze();
        }
        
        return new Promise(resolve => resolve(true));
    }

    //各クラスの状態を可視化
    checkStatus(){
        for(let v in this.statuses){
            switch(v){
                case 'websocket':
                    if(!this.board.stateWsOn){
                        this.statuses.websocket.status = 'red'
                        break;
                    }
                    if(this.board.stateAccumulating){
                        this.statuses.websocket.status = 'yellow';
                        break;
                    }
                    this.statuses.websocket.status = 'green';
                    break;
                case 'API':
                    if(!Market.stateUpdateBoard){
                        this.statuses.API.status = 'red';
                        break;
                    }
                    if(this.board.stateFaildUpdateBoardOnce){
                        this.statuses.API.status = 'yellow';
                        break;
                    }
                    if(this.board.stateUpdateBoard){
                        this.statuses.API.status = 'green';
                        break;
                    }
                    break;
                case 'outOfRange':
                    if(this.method.posSigma > this.board.boardSnapMaxPrice){
                        this.statuses.outOfRange.status = 'red';
                        //console.log(`Out of range posSigma : ${this.method.posSigma} boardSnapMaxPrice : ${this.board.boardSnapMaxPrice}`);
                        break;
                    }
                    if(this.method.negSigma < this.board.boardSnapMinPrice){
                        this.statuses.outOfRange.status = 'red';
                        //console.log(`Out of range posSigma : ${this.method.negSigma} boardSnapMinPrice : ${this.board.boardSnapMinPrice}`);
                        break;
                    }
                    this.statuses.outOfRange.status = 'green';
                    break;
                //end of API
                case 'method':
                    if(!this.method.stateJudgeStart){
                        this.statuses.method.status = 'yellow';
                    }else{
                        this.statuses.method.status = 'green';
                    }
                    break;
                //end of method
                case 'marketMasterPermission':
                    if(this.market.stateMasterPermission){
                       this.statuses.marketMasterPermission.status = 'green'; 
                    }else{
                        this.statuses.marketMasterPermission.status = 'red';
                    }
                    break;
                //end of method
                case 'marketOrderMonitering':
                    if(this.market.stateOrderMonitoring){
                        this.statuses.marketOrderMonitering.status = 'yellow';
                    }else{
                        this.statuses.marketOrderMonitering.status = 'green';
                    }
                    break;
                //end of marketOrderMonitering
                case 'marketHealth':
                    if(!Market.prototype.stateMarket){
                        this.statuses.marketHealth.status = 'red';
                        break;
                    }
                    if(Market.prototype.marketHealth == 'SUPER BUSY'){
                        this.statuses.marketHealth.status = 'yellow';
                        break;
                    }
                    if(Market.prototype.stateMarket){
                        this.statuses.marketHealth.status = 'green';
                        break;
                    }
                    break;
                //end of marketHealth
                case 'marketWeb':
                    if(this.market.bf.stateIsFreeze){
                        this.statuses.marketWeb.status = 'red';
                        break;
                    }
                    if(this.market.bf.stateInInitializing){
                        this.statuses.marketWeb.status = 'yellow';
                        break;
                    }
                    if(!this.market.bf.stateIsFreeze){
                        this.statuses.marketWeb.status = 'green';
                        break;
                    }
                    break;
                //end of marketWeb
                case 'inOrderPushButton':
                    if(this.market.bf.latestOrderReq === null){
                        this.statuses.inOrderPushButton.status = 'yellow';
                        break;
                    } 
                    if(this.market.bf.latestOrderReq.stateCompletePushButton){
                        this.statuses.inOrderPushButton.status = 'green';
                    }else{
                        this.statuses.inOrderPushButton.status = 'red';
                    }
                    break;
                //
                case 'inOrderCompleteOrder' :
                    if(this.market.bf.latestOrderReq === null){
                        this.statuses.inOrderPushButton.status = 'yellow';
                        break;
                    } 
                    if(this.market.bf.latestOrderReq.stateCompleteOrder){
                        this.statuses.inOrderCompleteOrder.status = 'green';
                    }else{
                        this.statuses.inOrderCompleteOrder.status = 'red';
                    }
                    break;
                //
                case 'inOrderCompleteExecution' :
                    if(this.market.bf.latestOrderReq === null){
                        this.statuses.inOrderPushButton.status = 'yellow';
                        break;
                    } 
                    if(this.market.bf.latestOrderReq.stateCompleteExecution){
                        this.statuses.inOrderCompleteExecution.status = 'green';
                    }else{
                        this.statuses.inOrderCompleteExecution.status = 'red';    
                    }
                    break;
                //
                case 'inOrderUnaccountedOrder' :
                    if(this.market.bf.latestOrderReq === null){
                        this.statuses.inOrderPushButton.status = 'yellow';
                        break;
                    } 
                    if(this.market.bf.latestOrderReq.stateUnaccountedOrder){
                        this.statuses.inOrderUnaccountedOrder.status = 'red';
                    }else{
                        this.statuses.inOrderUnaccountedOrder.status = 'green';
                    }
                //
            }
        }
    }
}

const myBot = new Bot();

{
    
    let laptime = 0;
    let isWaitingMarketRestart = false;
    let lastReportingTimeToTwitter = Date.now();
    const reportInterval = 1000 * 60 * 60;

    console.log(`in Main`);

    //myBotで設定したloopInterval[ms]毎に処理を行う。laptimeで管理。
    async function myLoop(){
        laptime = Date.now();
        const dt = new Date();

        //メンテ中でbot停止状態じゃなければ
        if(!isWaitingMarketRestart){
            if(myBot.board.stateAvailable){
                await myBot.loopTask();
            }
            //console.log(`myLoop ${Date.now() - laptime}[ms]`);
            //console.log(`${dt.getHours()}h ${dt.getMinutes()}m`);

            //Twitterへ定時報告
            if(Date.now() - lastReportingTimeToTwitter > reportInterval){
                let statsuesText = '';
                for(let v in myBot.statuses){
                    if(myBot.statuses[v].status != 'green'){
                        statsuesText += `${myBot.statuses[v].text} : ${myBot.statuses[v].status}\n`;
                    }
                }
                if(statsuesText == ''){
                    statsuesText = 'システム オールグリーン!\n';
                }
                myBot.twitter.sendDM(`定時報告をするよ！botは正常に稼働中！\n ${statsuesText}前回起動からの推定利益 :${myBot.market.updateNowProfit()}\n`);
                lastReportingTimeToTwitter = Date.now();
            }

            //sfd5%になったらbot停止
            /*
            if(myBot.market.bf.sfd >= 5.1){
                myBot.method.stateForcedTermination = true;
                if(myBot.market.side == 'NP'){
                    myBot.board.stopUpdate();
                    myBot.market.bf.stopUpdate();
                    myBot.twitter.sendDM(`sfdが5％になったからbotを停止したよ！`);
                    isWaitingMarketRestart = true;
                    return 0;
                    //BfWeb待機モード指示
                }
            }
            */

            //毎日のメンテナンス時間が近づいたらポジションクローズしてbot停止
            if(dt.getHours() === 3 && dt.getMinutes() > 54){
                myBot.method.stateForcedTermination = true;
                if(myBot.market.side == 'NP'){
                    myBot.board.stopUpdate();
                    //myBot.market.bf.stopUpdate();
                    isWaitingMarketRestart = true;
                    //BfWeb待機モード指示
                }
            }
        }else{
            //メンテ終わったら初期化してbot再始動
            Market.updateMarketState();
            if((dt.getHours() === 4 && dt.getMinutes() > 15) && Market.prototype.stateMarket){
                //await myBot.market.bf.restartUpdate();
                myBot.board = null;
                myBot.board = new RealtimeBoard(myBot.startInterval);
                myBot.method = null;
                myBot.method = new Method(myBot.t,myBot.sigma,-1,myBot.orderSizeHalf);
                isWaitingMarketRestart = false;
            }
        }

        //ページ表示用の状態達更新
        myBot.checkStatus();

        laptime = myBot.loopInterval - (Date.now()-laptime);
        if(laptime < 1) laptime = 1;
        await global.asyncSleep(laptime);

        myLoop();
    }


    myBot.market.pastTime = Date.now();
    //document.getElementById('start_time').innerHTML = dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss');
    myLoop();
}




module.exports = function(receiveFromAppJs){
    const router = express.Router();
    router.get("/", function(req, res, next){
        console.log('in controller');
        res.render("controller.ejs", {});
    });

    //スタートボタンが押されたら
    router.post("/start", function(req, res, next){
        myBot.start();
        console.log('in controller start');
        res.send({code:200,body:{message:'started.'}});
    });

    //ストップボタンが押されたら
    router.post("/stop", function(req, res, next){
        myBot.stop();
        console.log('in controller stop');
        res.send({code:200,body:{message:'stopped.'}});
    });


    router.get("/statuses", function(req, res, next){
        res.send({code:200,body:{data:myBot.statuses}});
    });

    return router;
};


