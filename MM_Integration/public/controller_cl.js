
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

class renderStatuses{
    constructor(){
        this.textBox = document.getElementById('left_div');
        this.ledBox = document.getElementById('right_div');
    }
    rendering(data){
        let textHtml = '';
        let ledHtml = '';
        for(let v in data){
            textHtml += `<div class="status_text">${data[v].text}</div>`;
            ledHtml += `<div class="led led-${data[v].status}"></div>`;
        }
        this.textBox.innerHTML = textHtml;
        this.ledBox.innerHTML = ledHtml; 
    }
}

const rs = new renderStatuses();

const clLoop = async()=> {
    myXhr('GET','/controller/statuses',(res)=>{
        if(res.code == 200){
            rs.rendering(res.body.data);
        }
    });
    await _asyncSleep(1200);
    clLoop();
}

{
    const startButton = document.getElementById('start_button');
    const stopButton = document.getElementById('stop_button');

    startButton.addEventListener('click',()=>{
        myXhr('POST','/controller/start',(res)=>console.log(res.body.message));
    });
    stopButton.addEventListener('click',()=>{
        myXhr('POST','/controller/stop',(res)=>console.log(res.body.message));
    });
    clLoop();
}