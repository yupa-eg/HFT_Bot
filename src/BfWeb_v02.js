
//取引所のサイトをスクレイピングして注文をするクラス
//注文ボタンを押してから約定されるまでを管理する
//ページフリーズ、最大注文サイズ以上の注文がされた場合の修正等のイレギュラーにも対応
//取引所サイトのあらゆるイレギュラーに対応した結果スパゲティコードになってしまった・・・

const BigNumber = require('bignumber.js');
const readline = require('readline-sync');
const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const driver = new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().windowSize({width:700,height:1050})).build();
const MyTwitter = require('./MyTwitter.js');

//Marketクラスからの注文リクエストを管理するクラス
class OrderRequest{
    constructor(side,size,stamp,cb){
        this.side = side;
        this.size = size;
        this.assignSize = new BigNumber(size);  //符号付きサイズ(売りならマイナスの値)
        if(side == 'SELL') this.assignSize = this.assignSize.times(-1);
        this.stamp = stamp;
        this.cb = cb;
        this.stateCompletePushButton = false;
        this.stateCompleteOrder = false;        //ButtonがisCheck or isNormalになったら
        this.stateCompleteExecution = false;    //ラベルに注文後のサイズが表示されたら
        this.stateUnaccountedOrder = false;     //buttonがis-waitingのまま30秒以上経過したら注文できたかどうか不明とする 
        this.stampPushButton = 0;
        this.stampStartCheckEcecution = 0;
    }
}

//取引所ページの情報取得・操作をするクラス
class BfWebSv{
    constructor(maxOrderSize,minOrderSize){
        this.orderButton = {
            SELL:null,
            BUY:null
        }
        this.maxOrderSize = maxOrderSize;
        this.minOrderSize = minOrderSize;
        this.nowSizeLabel = null;           //現在保有してるサイズのラベル。　保有してないときは非表示
        this.orderSizeForm = null;          //注文サイズを入力する input type=text
        this.orderErrorLabel = null;        //エラーラベル　通常はgetText() == ''？;
        this.stateHasPosition = false;      //nowSizeLabelのisDisplayed
        this.stateIsFreeze = false;   
        this.stateInInitializing = true;
        this.stateBreak = false;
        this.hasSize = 0;
        this.inFormSize = 0;
        this.realtimeHasSize = 0;
        this.bidSumLabel = null;
        this.CHECK_FREEZE_INTERVAL = 5 * 1000;
        this.latestOrderReq = null;
        this.sfd = null;
        this.sfdLabel = null;
        this.freezeCheckLastUpdateTime = null;
        this.twitter = new MyTwitter();
    }
    get bfLoginId(){
        return process.env.BF_LOGIN_ID;
    }
    get bfLoginPass(){
        return process.env.BF_LOGIN_KEY;
    }
    async initWindow(){
        try {
            //ページを開いてID,Passを入力、ログインボタンをクリック
            await driver.get('https://lightning.bitflyer.com/');
            await driver.findElement(By.id('LoginId')).sendKeys(this.bfLoginId);
            await driver.findElement(By.id('Password')).sendKeys(this.bfLoginPass);
            await driver.findElement(By.id('login_btn')).click();
            
            //2段階認証入力　コンソールで入力する
            let bfLoginNumber = readline.question('Two factor code is ...');
            //console.log(`Your enter code is ... ${bfLoginNumber}`);
            await driver.findElement(By.className('auth__input')).sendKeys(bfLoginNumber,Key.RETURN);
            
            //重要なお知らせの閉じるをクリックして
            /*
            let importantButton = null;
            try{
                driver.wait(until.elementLocated(By.id('js-important-notice-button')),10000);
            } catch(err){
                console.log(`important button is not defined`);
            }
            if(importantButton) await importantButton.click();
            */
            
            await this.initMainPage();

            await global.asyncSleep(this.CHECK_FREEZE_INTERVAL);
            this.checkFreeze();
           
        } finally {
            console.log('Login done.');
            this.twitter.sendDM(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] Bot start.`);
        }
    
    }
    async initMainPage(isFreezed = false){
      
        const marketOrderButton = driver.wait(until.elementLocated(By.xpath(`//div[@id='orderPanel']/div[@class='order-wrap']/div[@class='button-group order__tab']/label[2]/span[@class='button-group-item']`)));
        await marketOrderButton.click();
        console.log('Page initializing ... 1');

        await global.asyncSleep(3000);

        //売買ボタン
        this.orderButton.SELL = await driver.wait(until.elementLocated(By.className('place__button--sell noSelect is-normal')));
        this.orderButton.BUY = await driver.findElement(By.className('place__button--buy noSelect is-normal'));
        console.log('Page initializing ... 2');

        //注文サイズ入力フォーム
        this.orderSizeForm = await driver.findElement(By.className('place__size'));
        this.nowSizeLabel = await driver.findElement(By.xpath(`//li[contains(@class, 'pnl__funds pnl__funds--derivative _is-active')]/span[@class='pnl__position']`));
        this.orderErrorLabel = await driver.findElement(By.className('place__error low-strobe'));
        this.bidSumLabel = await driver.findElement(By.xpath(`//div[@id='board']/footer[@class='bidsum']/span[2]/span[@class='bidsum__label']`));
        this.sfdLabel = await driver.findElement(By.xpath(`//div[@id='orderPanel']/div[@class='order-wrap']/div[@class='order__padding']/div[@class='place__form--limit']/div[3]/span[@class='sfd__estimate']/span[@class='sfd__disparity']`));
        console.log('Page initializing ... 3');

        if(!isFreezed){
            this.stateHasPosition = await this.nowSizeLabel.isDisplayed();
            if(this.stateHasPosition){
                this.hasSize = Number((await this.nowSizeLabel.getText()).slice(0,-3));
            }else{
                this.hasSize = 0;
            }
        }else{
            this.stateIsFreeze = false;
        }
        console.log('Page initializing ... 4');

        this.inFormSize = await this.orderSizeForm.getAttribute("value");

        console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] Main page init done.`);
        this.stateInInitializing = false;
        return new Promise(resolve => setTimeout(resolve, 1));        
    }
    
    async pushOrder(side,size,stamp,myCallback){
        if((this.latestOrderReq && !this.latestOrderReq.stateCompleteExecution) || this.stateIsFreeze){
            
            if(this.stateIsFreeze){
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] Bf Web is Freeze now.`);
            }else{
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] Bf Web is in Order now.`);
            }
            await global.asyncSleep(5000); 
            this.latestOrderReq.cb({message:`Bf Web is in Order now`,code:503});
        }

        this.latestOrderReq = new OrderRequest(side,size,stamp,myCallback);
        
        //フォームに入力されている値とリクエストサイズが異なるならサイズを入力
        if(this.inFormSize != this.latestOrderReq.size){
            await this.orderSizeForm.clear();
            await this.orderSizeForm.sendKeys(this.latestOrderReq.size);
            this.inFormSize = this.latestOrderReq.size;
        }
        //push the button
        await this.orderButton[this.latestOrderReq.side].click();
        this.latestOrderReq.stateCompletePushButton = true;
        console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] pushed ${this.latestOrderReq.side} button.`);
        this.latestOrderReq.stampPushButton = Date.now();
        await global.asyncSleep(20);
        this.moniteringOrder();
    }
    async moniteringOrder(){
        //classNameがcheckになったら
        //console.log('moniteringOrder 1');
        const attr = await this.orderButton[this.latestOrderReq.side].getAttribute('class');
        //console.log('moniteringOrder 2');
        //最初は is-waiting
        if(attr == `place__button--${this.latestOrderReq.side.toLowerCase()} noSelect is-check` || attr == `place__button--${this.latestOrderReq.side.toLowerCase()} noSelect is-normal`){
            //console.log('moniteringOrder 3');
            //エラーテキスト待ち
            await global.asyncSleep(500); 
            this.latestOrderReq.stateCompleteOrder = true;
            if(await this.orderErrorLabel.getText() == ''){
                //エラーなければ注文通った
                //console.log('moniteringOrder 4');
                this.latestOrderReq.stampStartCheckEcecution = Date.now();
                this.moniteringExecution();
            }else{
                //エラーあったら投げて終了
                const message = await this.orderErrorLabel.getText();
                this.latestOrderReq.stateCompleteOrder = true; 
                this.latestOrderReq.stateCompleteExecution = true;
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] Order error. message is ${message}`);
                await global.asyncSleep(5000); 
                this.latestOrderReq.cb({message:message,code:503});
            }
        //checkになってないのに（is-waiting中に)エラーあったら
        }else if(await this.orderErrorLabel.getText() != ''){
            const message = await this.orderErrorLabel.getText();
            console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] is-waiting中の Order error. message is ${message}`);
            await global.asyncSleep(5000);
            this.latestOrderReq.stateCompleteOrder = true; 
            this.latestOrderReq.stateCompleteExecution = true;
            this.latestOrderReq.cb({message:message,code:503});
        //まだチェックにならないならもう一回！
        }else{
            //is-waitingの状態で30秒以上固まったら注文失敗でリロード
            if(Date.now() - this.latestOrderReq.stampPushButton > 30000){
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] ${this.latestOrderReq.side} button is freeze? reload page.`);
                this.stateIsFreeze = true;
                //ここで60秒以上ページ読み込みに時間かかったらしぬ
                await driver.wait(driver.navigate().refresh(),60000);
                await global.asyncSleep(200);
                await this.initMainPage(true);
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] order check retly after button freeze.`);
                this.latestOrderReq.stateCompleteOrder = true;
                this.latestOrderReq.stampStartCheckEcecution = Date.now();
                this.moniteringExecution();
            }else{
                await global.asyncSleep(50);
                this.moniteringOrder();
            }
        }
    }
    async moniteringExecution(){
        //size is BigNumber
        //フリーズ中なら
        if(this.stateIsFreeze){
            //何もせずにreload終わるまで待つ。
            await global.asyncSleep(200);
            this.moniteringExecution();
        }else{
            //console.log(`this.latestOrderReq.assignSize : ${this.latestOrderReq.assignSize.toNumber()}`);
            //position持ってるなら
            if(this.stateHasPosition){
                const cSize = this.latestOrderReq.assignSize.plus(this.hasSize).toNumber();
                if(cSize == 0){
                    //closeの処理（nowSizeLabelが表示されていない = ポジション 0 になったら)
                    if(!await this.nowSizeLabel.isDisplayed()){
                        console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] execution is done.Position close`);
                        this.stateHasPosition = false;
                        this.hasSize = 0;
                        this.latestOrderReq.stateCompleteExecution = true;
                        this.latestOrderReq.cb({message:`execution is done.`,code:200});
                        return 0;
                    }
                }else{
                    //ラベルの値が注文前のサイズ + 注文サイズになってるなら
                    if(Number((await this.nowSizeLabel.getText()).slice(0,-3)) == this.latestOrderReq.assignSize.plus(this.hasSize).toNumber()){
                        console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] execution is done.`);
                        this.stateHasPosition = true;
                        this.hasSize = Number((await this.nowSizeLabel.getText()).slice(0,-3));
                        this.latestOrderReq.stateCompleteExecution = true;
                        this.latestOrderReq.cb({message:`execution is done.`,code:200});
                        return 0;
                    }
                }
            //position無いなら//ラベルが表示されているかつラベルの値が注文サイズなら
            }else if(await this.nowSizeLabel.isDisplayed() && Number((await this.nowSizeLabel.getText()).slice(0,-3)) == this.latestOrderReq.assignSize.toNumber()){
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] execution is done.`);
                this.stateHasPosition = true;
                this.hasSize = Number((await this.nowSizeLabel.getText()).slice(0,-3));
                this.latestOrderReq.stateCompleteExecution = true;
                this.latestOrderReq.cb({message:`execution is done.`,code:200});
                return 0;    
            }


            //moniteringExecution始めてから2分以上経過して
            if(Date.now() - this.latestOrderReq.stampStartCheckEcecution > 120 * 1000){
                if(!this.latestOrderReq.stateUnaccountedOrder){
                    this.latestOrderReq.stateUnaccountedOrder = true;
                    this.latestOrderReq.stampStartCheckEcecution = Date.now();
                    console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}]  order is unaccounted. retly execution check.`);
                    //ここで60秒以上ページ読み込みに時間かかったらしぬ
                    this.stateIsFreeze = true;
                    await driver.wait(driver.navigate().refresh(),60000);
                    await global.asyncSleep(2000);
                    await this.initMainPage(true);
                }else if(this.latestOrderReq.stateUnaccountedOrder){
                    this.latestOrderReq.stateCompleteExecution = true;
                    console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}]  order is unaccounted possible.`);
                    this.latestOrderReq.cb({message:`order is unaccounted. plese order retly.`,code:504});
                    this.twitter.sendDM(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] 注文が行方不明だよ！`);
                    return 0;
                }
            }
            await global.asyncSleep(200);
            //console.log('execution check retly.');
            this.moniteringExecution();
        }    
    }
    async checkFreeze(){
        //console.log('check freeze ...');
        this.freezeCheckLastUpdateTime = Date.now();
        if(this.stateBreak){
            console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] stop freeze check.`);
            return 0;
        }
        //初注文済みかつボタンcheck後なら
        if(this.latestOrderReq && this.latestOrderReq.stateCompleteOrder && !this.stateIsFreeze){    
            const value = await this.bidSumLabel.getText();
            const limitTime = 10000;
            let laptime = 0;
            const tickTime = 1000;
            while(laptime < limitTime){
                await global.asyncSleep(tickTime);
                //console.log(`bidSumLabel ... ${`)
                const newValue = await this.bidSumLabel.getText();
                //console.log(`initial value : ${value}, new value : ${newValue}`);
                if(value != newValue){
                    break;
                }else{
                    laptime += tickTime;
                }
            }
            if(laptime >= limitTime){
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] Freeze check is done. Page is NOT avalable.`);
                this.stateIsFreeze = true;
                try{
                    await driver.wait(driver.navigate().refresh(),60000);
                }catch(e){
                    console.log(`stale error...`);
                    this.twitter.sendDM(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] 取引ページがおかしいかもしれないよ！`);
                }
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] refresh done.`);
                await global.asyncSleep(200);
                await this.initMainPage(true);      
            }else{
                //console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] Freeze check is done. Page is avalable. `);
                this.stateIsFreeze = false;
                if(this.latestOrderReq.stateCompleteExecution){
                    let nowSize = 0;
                    if(await this.nowSizeLabel.isDisplayed()){
                        nowSize = Number((await this.nowSizeLabel.getText()).slice(0,-3));
                    }
                    
                    if(nowSize > this.maxOrderSize){
                        this.hasSize = nowSize;
                        this.twitter.sendDM(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] 現在の保有サイズが${nowSize}なので補正を試みるよ！`);
                        this.pushOrder('SELL',((this.hasSize * 1000) - (this.maxOrderSize * 1000))/1000 , Date.now(),()=>{
                            console.log(`Over size is corrected.`);
                            this.twitter.sendDM(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] サイズオーバーなので補正したよ！`);
                        });
                    }else if(nowSize < this.minOrderSize){
                        this.hasSize = nowSize;
                        this.twitter.sendDM(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] 現在の保有サイズが${nowSize}なので補正を試みるよ！`);
                        this.pushOrder('BUY',((this.minOrderSize * 1000) - (this.hasSize * 1000))/1000 , Date.now(),()=>{
                            console.log(`Over size is corrected.`);
                            this.twitter.sendDM(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] サイズオーバーなので補正したよ！`);
                        });
                    }
                }
            }
            await global.asyncSleep(this.CHECK_FREEZE_INTERVAL);
            this.checkFreeze();
        }else{
            if(this.latestOrderReq === null){
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] No first order. Do not freze check.`);
            }else if(this.stateIsFreeze){
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] In freeze now. Do not freze check.`);        
            }else{
                console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] In order now. Do not freze check.`);
            }
            await global.asyncSleep(this.CHECK_FREEZE_INTERVAL);
            this.checkFreeze();
        }
    }
    async checkhasSize(cb){
        if(!this.stateIsFreeze){
            if(!await this.nowSizeLabel.isDisplayed()){
                return 0;
            }else{
                return  Number((await this.nowSizeLabel.getText()).slice(0,-3));
            }
        }else{
            return null;
        }
    }
    stopUpdate(){
        this.stateBreak = true;
    }
    async restartUpdate(){
        try{
            await driver.wait(driver.navigate().refresh(),30000);
        }catch(e){
            console.log(`stale error...`);
        }
        console.log(`[${global.dateFormat.format(new Date(), 'yyyy/MM/dd hh:mm:ss')}] refresh done.`);
        await global.asyncSleep(200);
        await this.initMainPage();
        this.stateBreak = false;
        this.checkFreeze();
        return new Promise(resolve => setTimeout(resolve, 1)); 
    }
    _outputError(res){
        console.log('/////////////////////////////////////////////////////////////////////\n');
        console.log(`statusCode ${res.statusCode}@${JSON.stringify(res.request.uri.path)}`);
        console.log(`message ${res.statusMessage}`);
        console.log('\n/////////////////////////////////////////////////////////////////////');
    }
}


module.exports = BfWebSv;

