const MyOrder = require('./MyOrder.js');
const MyInflux = require('./MyInflux.js');


//売買判定、板、価格データを用いて売買判定のための計算、メソッド側のポジション管理を行うクラス

class MyFourthMethod extends MyOrder{
    constructor(t,nsigma,id,orderVol,isMaster=true){
        super(orderVol);

        //初期化の際任意で設定する定数
        this.t = t;
        this.nsigma = nsigma;

        this.bigNsigma = (nsigma*10 + 10)/10;
    
        this.id = id;

        //ltp（最終取引価格）関係
        this.ltpAve = 0;
        this.ltpPosSigma = 0;
        this.ltpNegSigma = 0;


        //板・取引量関係　※ltvd:latestVolumeDifference
        this.boardVolumeBuy = 0;
        this.boardVolumeSell = 0;
        
        this.ltvd = [];             
        this.ltvdAve = 0;
        this.ltvdPosSigma = 0;
        this.ltvdNegSigma = 0;
        this.ltvdLateTime = Math.round(this.t / 4);
        this.ltvdLateSigmas = new Array();

        //この値で売買シグナルを判断する
        this.judgeValue = 0;

        this.stateJudgeStart = false;
        this.stateForcedTermination = false;    //強制終了モード

        this.isMaster = isMaster;


        if(this.isMaster){
            this.influx = new MyInflux('btcfx_mini_master',[5,5],[
                {
                    measurement: 'methods_parameter',
                    fields: {
                        boardVolumeBuy: 'float',
                        boardVolumeSell: 'float',
                        last_ltvd: 'float',
                        ltvd_ave: 'float',
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
        }else{
            console.log('in method not master.(Not compatible.)')
        }
    }

    judgment(board,market){
        
        //強制終了モード（メンテ時等）ならポジションクローズ
        if(this.stateForcedTermination){
            if(this.side != 'NP'){
                super.updateOrder('NP',board.bestBid);
            }
            if(market.side != 'NP') { 
                market.updateMarketOrder('NP',this.nsigma,this.t);
            }
            return 0;
        }


        this.setLtvd(board);

        if(this.ltvd.length == 1) return 0;
        if(!this.stateJudgeStart) return 0;

        this.ltvdAve = 0;
        for(let i=0;i<this.ltvd.length;i=(i+1)|0){
            this.ltvdAve = this.ltvdAve + (this.ltvd[i].ltvdVol * global.ROUND_DIGITS);
        }

        //この時点でまだglobal.ROUND_DIGITS倍 
        //先に割り算してるけどsetLtvdでglobal.ROUND_DIGITS以下の小数点は四捨五入してるので必ず整数になり割り算で出た小数のみ切り捨てる
        this.ltvdAve = Math.round(this.ltvdAve/this.ltvd.length); 

        //Σ(xi-xave)^2の計算//n-1で割ってルート.
        let sigma = 0;  
        for(let i=0;i<this.ltvd.length;i=(i+1)|0){
            sigma = sigma + ((this.ltvd[i].ltvdVol*global.ROUND_DIGITS - this.ltvdAve) ** 2);
        }
        
        sigma = Math.round(Math.sqrt(sigma/(this.ltvd.length-1)));
        
        //ltvd ± nσのテイカー合計
        this.ltvdPosSigma = (this.ltvdAve + ((sigma*20)/10))/global.ROUND_DIGITS;
        this.ltvdNegSigma = (this.ltvdAve - ((sigma*20)/10))/global.ROUND_DIGITS;

        const judgeValue = (this.ltvd[this.ltvd.length-1].ltvdVol*global.ROUND_DIGITS + this.ltvdAve)/global.ROUND_DIGITS;
        this.judgeValue = judgeValue;
        
        
        
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

        
        /*
            最初はNP→どっちかのσ超えたら順方向にポジ持つ
            ポジ持った方とは逆のsigmaをしきい値とし、そこを超えたら反対のポジ持つ
        */
        //売買判定
        if(this.side == 'BUY' && judgeValue < this.ltvdNegSigma){
            //順張り！
            super.updateOrder('SELL',board.bestBid);
            market.updateMarketOrder('SELL',this.nsigma,this.t);
            return 0;    
        }else if(this.side == 'SELL' && judgeValue > this.ltvdPosSigma){
            //順張り！
            super.updateOrder('BUY',board.bestAsk);
            market.updateMarketOrder('BUY',this.nsigma,this.t);
            return 0; 
        //初めてのorderなら   
        }else if(this.side == 'NP'){
            //sigmaタッチ判定
            if(judgeValue >  this.ltvdPosSigma){ 
                //順張り！
                super.updateOrder('BUY',board.bestAsk);
                market.updateMarketOrder('BUY',this.nsigma,this.t);
                return 0;    
            }else if(judgeValue < this.ltvdNegSigma){
                //順張り！
                super.updateOrder('SELL',board.bestBid);
                market.updateMarketOrder('SELL',this.nsigma,this.t);
                return 0;
            }
        }
       
        //simとrealで注文異なってたときsimに合わせる
        if(this.side != market.side &&  !market.stateOrderMonitoring && !market.stateProcessing && market.stateMasterPermission){
            market.updateMarketOrder(this.side,this.nsigma,this.t);
        }
        return 0;
    }

    
    setLtvd(board){
    
        let execVolumeBuy = 0;             //過去t秒間の約定履歴買い側取引量合計
        let execVolumeSell = 0;             //過去t秒間の約定履歴売り側取引量合計
        let boardVolumeBuy = 0;             //board.buyBoardのある範囲までの合計
        let boardVolumeSell = 0;             //board.sellBoardのある範囲までの合計

        
        //過去t秒間の約定履歴取引量合計execVolumeBuy,execVolumeSellの算出
        for(let i=0; i < board.executions.length; i=(i+1)|0){
            if(board.executions[i].side == 'BUY'){
                execVolumeBuy = execVolumeBuy + Math.round(board.executions[i].vol * global.ROUND_DIGITS);
            }else if(board.executions[i].side == 'SELL'){
                execVolumeSell = execVolumeSell + Math.round(board.executions[i].vol * global.ROUND_DIGITS);
            }
        }

        const bsSum = Math.round(execVolumeBuy - execVolumeSell);
        execVolumeBuy = Math.round(execVolumeBuy);
        execVolumeSell = Math.round(execVolumeSell);
        

        this.influx.pushData('execution_volume',{
            measurement: 'execution_volume',
            tags: {
                type: 'global'
            },
            fields: {
                execVolumeBuy: execVolumeBuy/global.ROUND_DIGITS,
                execVolumeSell: execVolumeSell/global.ROUND_DIGITS,
                bsSum:bsSum/global.ROUND_DIGITS
            },
            timestamp: new Date()
        });


        const subjectPrices = board.trueMidPrices;

        //bot稼働直後やwebsocket停止時、　RealtimeBoardにpriceが貯まっていなければ計算を行わない
        if(subjectPrices.length < 2) return 0;

        const priceLatestTime = subjectPrices[subjectPrices.length-1].stamp;

        const slicedLastPrices = subjectPrices.filter((value) => {
            return priceLatestTime - value.stamp <= this.t
        });

        if(slicedLastPrices.length < 2) return 0;

        //平均とσを求める（※インライン化）
        let tempLtpAve = 0;
        for(let i=0;i<slicedLastPrices.length;i=(i+1)|0){
            tempLtpAve = tempLtpAve + slicedLastPrices[i].price;
        }
        
        this.ltpAve = Math.round(tempLtpAve/slicedLastPrices.length);


        //Σ(xi-xave)^2の計算//n-1で割ってルート.
        let sigma = 0  
        for(let i=0;i<slicedLastPrices.length;i=(i+1)|0){
            sigma = sigma + ((slicedLastPrices[i].price - this.ltpAve) ** 2);
        }
        
        sigma = Math.round(Math.sqrt(sigma/(slicedLastPrices.length-1)));
        

        //lastPrice ± Aσのテイカー合計
        this.ltpPosSigma = Math.round(this.ltpAve + ((sigma * (this.nsigma*10))/10));
        this.ltpNegSigma = Math.round(this.ltpAve - ((sigma * (this.nsigma*10))/10));

        //console.log(`volatility is from ${negSigma} to ${posSigma}. `);


        //boardVolumeBuy算出
        const slicedBuyBoard = board.buyBoard.slice(this.ltpNegSigma,this.ltpAve);
        for(let v in slicedBuyBoard){
            boardVolumeBuy = boardVolumeBuy + (slicedBuyBoard[v] * global.ROUND_DIGITS);
        }
        boardVolumeBuy = Math.round(boardVolumeBuy);
        this.boardVolumeBuy = boardVolumeBuy;


        //boardVolumeSell算出　切り取る必要ない？
        const slicedSellBoard = board.sellBoard.slice(this.ltpAve,this.ltpPosSigma);
        for(let v in slicedSellBoard){
            boardVolumeSell = boardVolumeSell + (slicedSellBoard[v] * global.ROUND_DIGITS);
        }
        boardVolumeSell = Math.round(boardVolumeSell);
        this.boardVolumeSell = boardVolumeSell;


        const now = Date.now();

        //この式要検討
        const result = (((2 * execVolumeBuy) - (2 * execVolumeSell)) - boardVolumeSell + boardVolumeBuy)/global.ROUND_DIGITS;
        this.ltvd.push({ltvdVol:result,stamp:now});

        
        if(result > 5000) {
            console.log(`posSigmaがおかしい sigma:${sigma}, ltpAve:${this.ltpAve}, slicedLastPrice.length:${slicedLastPrices.length}`);
            console.log(`ltvdがおかしい? ltvd:${result},ltvd.length:${this.ltvd.length}, possigma:${this.ltpPosSigma}, negsigma:${this.ltpNegSigma}, `);
            console.log(`ltvdがおかしい? execVolumeBuy:${execVolumeBuy}, execVolumeSell:${execVolumeSell}, boardVolumeBuy:${boardVolumeBuy},boardVolumeSell:${boardVolumeSell} `);
        }
        
        while(1){
            if(this.ltvd[this.ltvd.length-1].stamp - this.ltvd[0].stamp > this.t){
                this.ltvd.shift();
                this.stateJudgeStart = true;    
            }else{ 
                break;
            }
        }
    }
}

module.exports = MyFourthMethod;