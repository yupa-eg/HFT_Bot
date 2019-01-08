//ポジションと損益を管理するクラス

class MyOrder{
    constructor(vol){
        this.side = 'NP';
        this.price = 0;
        this.vol = vol;
        this.profit = 0;
        this.nowProfit = 0;
        this.realTimeProfit = 0;
        this.tradeCount = 0;
        //this.tradeHistory = new Array();
    }

    updateOrder(reqSide,execPrice){
        //const tVol = new BigNumber(this.vol);
        let diff = 0;
        switch(this.side){
            case 'NP' :
                diff = 0;
                break;
            //end of NP
            case 'BUY' :  //BUY -> SELL
                //今の価格 - 買ったときの価格 銀行丸めしてtoNumber
                diff = Math.round((((this.vol * global.ROUND_DIGITS_MIN) * execPrice) - ((this.vol * global.ROUND_DIGITS_MIN) * this.price))/global.ROUND_DIGITS_MIN);
                break;
            //end of BUY
            case 'SELL' :  //SELL -> BUY
                //売ったときの価格 - 今の価格 銀行丸めしてtoNumber
                diff = Math.round((((this.vol * global.ROUND_DIGITS_MIN) * this.price) - ((this.vol * global.ROUND_DIGITS_MIN) * execPrice))/global.ROUND_DIGITS_MIN);  
                break;
            //end of SELL
        }
        this.profit +=  diff;
        this.side = reqSide;
        this.price = execPrice;
        this.tradeCount = (this.tradeCount+1)|0;
    }
    updateNowProfit(){
        switch(this.side){
            case 'NP' :
                this.nowProfit = 0;
                break;
            //end of NP
            case 'BUY' :  //BUY -> SELL
                //今の価格 - 買ったときの価格 銀行丸めしてtoNumber
                this.nowProfit = Math.round((((this.vol * global.ROUND_DIGITS_MIN) * global.gBestAsk) - ((this.vol * global.ROUND_DIGITS_MIN) * this.price))/global.ROUND_DIGITS_MIN);
                break;
            //end of BUY
            case 'SELL' :  //SELL -> BUY
                //売ったときの価格 - 今の価格 銀行丸めしてtoNumber
                this.nowProfit = Math.round((((this.vol * global.ROUND_DIGITS_MIN) * this.price) - ((this.vol * global.ROUND_DIGITS_MIN) * global.gBestBid))/global.ROUND_DIGITS_MIN);
                break;
            //end of SELL
        }
        this.realTimeProfit = this.profit + this.nowProfit;
        
        return this.realTimeProfit;
    }
}

module.exports = MyOrder;