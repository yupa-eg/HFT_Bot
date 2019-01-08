
const ROUND_DIGITS = 1000000;               //小数計算の際の倍数

const myXhr = (method,url,cb)=> {
    const xhrBf = new XMLHttpRequest();
    xhrBf.open(method,url);
    xhrBf.addEventListener("load", function(e){
        if(xhrBf.readyState == 4) {
            if(xhrBf.status == 200 || xhrBf.status == 201) {
                // リクエストの処理
                let parsedRes = "";
                try{
                    parsedRes = JSON.parse(xhrBf.responseText); 
                }catch(e){
                    parsedRes = {body:{message:'xhr json parce error'},code:301};
                }
                cb(parsedRes);
            } else {
                // エラー処理
                cb({body:{message:'xhr error'},code:300});
            }
        }
        
    });
    xhrBf.send();
}

const _asyncSleep = (msec)=>{
    return new Promise(resolve => setTimeout(resolve, msec));
}

/*
const clLoop = async()=> {
    myXhr('GET','/controller/statuses',(res)=>{
        if(res.code == 200){
            rs.rendering(res.body.data);
        }
    });
    await _asyncSleep(1200);
    clLoop();
}
*/


//main
{
    const calcButton = document.getElementById('start_button');
    const progressLabel = document.getElementById('progress');
    const countLabel = document.getElementById('get_count');

    const progress = ()=>{
        myXhr('GET','/tester/get_progress',async(res)=>{
            console.log(res);
            /*
                進捗表示する処理（描画）
            */
            if(res.code == 200){
                progressLabel.innerHTML = `progress ... ${res.propotion} %`;
                countLabel.innerHTML = `count ... ${res.count}`;
            }else{
                progressLabel.innerHTML = `progress ... err %`;
                countLabel.innerHTML = `count ... err`;
            }

            if(res.propotion < 100 || res.code != 200){
                await _asyncSleep(500);
                progress();
            }else if(res.propotion != undefined){
                progressLabel.innerHTML = `progress ... ${res.propotion} % Done!`;
                countLabel.innerHTML = `count ... ${res.count} Done!`;
            }
        });
    }
    calcButton.addEventListener('click',()=>{
        myXhr('GET','/tester/get_execution',async(res)=>{
            console.log(res);
            if(res.code == 200){
                //0.5秒毎に進捗問い合わせる
                progress();
            }
            //calc(res);
        });
    });
}
