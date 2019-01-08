//node.js標準
const crypto = require("crypto"); 

const request = require("request");


//https://lightning.bitflyer.com/docs
//api plaugroundのサンプルコードを参考にした

class BfAPI{
    constructor(){
    }
    get key(){
        //return 'Dummy';
        return process.env.BF_ACCESS_KEY;
    }
    get secret(){
        //return 'Dummy';
        return process.env.BF_SECRET_KEY;
    }
    get endPointURL(){
        return 'https://api.bitflyer.jp'
    }
    getBoardState(pc='FX_BTC_JPY',myCallback){
        const options ={
            url:`${this.endPointURL}/v1/getboardstate?product_code=${pc}`,
            method : 'GET',
            headers:{
                "Content-Type" : "application/json"
            },
            json:true
        }
        request(options,(error,res,body)=>{
            if(error){
                console.log(`error is ${error}@getBoardState`);
                body = {message:'error recieved.'};
                myCallback(error,res,body,100);
                return 0;
            }
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
        });
    }
    getBoard(pc='FX_BTC_JPY',myCallback){
        const options ={
            url:`${this.endPointURL}/v1/getboard?product_code=${pc}`,
            method : 'GET',
            headers:{
                "Content-Type" : "application/json"
            },
            json:true
        }
        request(options,(error,res,body)=>{
            if(error){
                console.log(`error is ${error}@getBoard`);
                body = {message:'error recieved.'};
                myCallback(error,res,body,100);
                return 0;
            }
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
        });
    }
    getPositions(myCallback){
        const timestamp = Date.now().toString();
        const path = '/v1/me/getpositions' + '?product_code=FX_BTC_JPY';
        const sign = this._createSign(timestamp,path,'GET');
        const options ={
            url: this.endPointURL + path,
            method : 'GET',
            headers: {
                'ACCESS-KEY': this.key,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-SIGN': sign,
                'Content-Type': 'application/json'
            },
            json:true
        }
        /*
        console.log('//////////////////////////////////////////////////////');
        console.log('sendChilOrder last check.');
        console.log(`myCallBack is ${JSON.stringify(myCallback)}`);

        console.log(`send sign is ${sign}`);
        console.log(`Option of request argments is ${JSON.stringify(options)}`);
        */
        request(options,(error,res,body)=>{
            if(error)console.log(`error is ${error}@getPositions`);
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
        });
        
    }
    getCollateral(myCallback){
        const timestamp = Date.now().toString();
        const path = '/v1/me/getcollateral';
        const sign = this._createSign(timestamp,path,'GET');
        const options ={
            url: '' + this.endPointURL + path,
            method : 'GET',
            headers: {
                'ACCESS-KEY': this.key,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-SIGN': sign,
                'Content-Type': 'application/json'
            },
            json:true
        }
        request(options,(error,res,body)=>{
            if(error)console.log(`error is ${error}@getCollateral`);
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
        });
    }
    getExecutions(pc,id,myCallback){
        const timestamp = Date.now().toString();
        const path = '/v1/me/getexecutions'+ '?product_code=' + pc + '&child_order_acceptance_id=' + id;
        const sign = this._createSign(timestamp,path,'GET');
        const options ={
            url: '' + this.endPointURL + path,
            method : 'GET',
            headers: {
                'ACCESS-KEY': this.key,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-SIGN': sign,
                'Content-Type': 'application/json'
            },
            json:true
        }
        request(options,(error,res,body)=>{
            if(error)console.log(`error is ${error}@getExecutions`);
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
        });
    }
    getExecutionsAll(pc,myCallback){
        const timestamp = Date.now().toString();
        const path = '/v1/me/getexecutions'+ '?product_code=' + pc + '&count=500';
        const sign = this._createSign(timestamp,path,'GET');
        const options ={
            url: '' + this.endPointURL + path,
            method : 'GET',
            headers: {
                'ACCESS-KEY': this.key,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-SIGN': sign,
                'Content-Type': 'application/json'
            },
            json:true
        }
        request(options,(error,res,body)=>{
            if(error)console.log(`error is ${error}@getExecutions`);
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
        });
    }
    sendChildOrder(_side,_size,_price=0,pc='FX_BTC_JPY',myCallback){
        const timestamp = Date.now().toString();
        const path = '/v1/me/sendchildorder';
        let bodyStr = "";
        if(_price == 0){
            bodyStr = JSON.stringify({                 
                product_code:pc,
                child_order_type:'MARKET',
                side:_side,
                size:_size
            });
        }else{
            bodyStr = JSON.stringify({                 
                product_code:pc,
                child_order_type:'LIMIT',
                price:_price,
                side:_side,
                size:_size
            });
        }

        const body = bodyStr;
        const sign = this._createSign(timestamp,path,'POST',body);
        const options ={
            url: this.endPointURL + path,
            method : 'POST',
            body : body,
            headers: {
                'ACCESS-KEY': this.key,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-SIGN': sign,
                'Content-Type': 'application/json'
            }
        }
        /*
        console.log('//////////////////////////////////////////////////////');
        console.log('sendChilOrder last check.');
        console.log(`Option of body is ${JSON.stringify(body)}`);
        console.log(`Arguments valie _side:${_side}, _size:${_size}, _pc:${pc},`);
        console.log(`myCallBack is ${JSON.stringify(myCallback)}`);

        console.log(`send body is ${body}`);
        console.log(`send sign is ${sign}`);
        console.log(`Option of request argments is ${JSON.stringify(options)}`);
        */

        request(options,(error,res,body)=>{
            if(error)console.log(`error is ${error}@sendChildOrder`);
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
        });
        
    }

    cancelChildOrder(pc,id,myCallback){
        const timestamp = Date.now().toString();
        const path = '/v1/me/cancelchildorder';
        const body = JSON.stringify({                 
            product_code:pc,
            child_order_acceptance_id:id
        });
        const sign = this._createSign(timestamp,path,'POST',body);
        const options ={
            url: '' + this.endPointURL + path,
            method : 'POST',
            body : body,
            headers: {
                'ACCESS-KEY': this.key,
                'ACCESS-TIMESTAMP': timestamp,
                'ACCESS-SIGN': sign,
                'Content-Type': 'application/json'
            }
        }
        request(options,(error,res,body)=>{
            if(error)console.log(`error is ${error}@cancelChildOrder`);
            if(res.statusCode != 200) this._outputError(res);
            myCallback(error,res,body,res.statusCode);
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

module.exports = BfAPI;