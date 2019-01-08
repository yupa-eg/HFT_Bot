const Twit = require("twit");

class MyTwtter{
    constructor(){
        this.twitter = new Twit({
            consumer_key: process.env.TWIBOT_TWITTER_KEY,
            consumer_secret: process.env.TWIBOT_TWITTER_SECRET,
            access_token: process.env.TWIBOT_TWITTER_TOKEN,
            access_token_secret: process.env.TWIBOT_TWITTER_TOKEN_SECRET
        });
        this.stopIncantation = process.env.INCANTATION;
        this.userId = process.env.TWIBOT_USER_ID;
        /*if(isMaster){
            this.stream = this.twitter.stream('user');
            this.stream.on('direct_message', function(data) {
                const message = data.direct_message
                // 自分が送信したダイレクトメッセージは処理しない
                console.log(`Twitter message recieved. message.sender_id_str:${message.sender_id_str} text:${message.text}`);
                //if (message.sender_id_str === ) return 0;
                if (message.sender_id !== this.userId) return 0;
                if(message.text === this.stopIncantation){

                }
            });
        }*/
    }
    sendDM(msg){
        const reply = { user_id: this.userId, text: msg };
        this.twitter.post('direct_messages/new', reply, function(err, data, resp) {});
    }
}

module.exports = MyTwtter;