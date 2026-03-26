const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();

const storage = multer.diskStorage({
destination: function(req,file,cb){
cb(null,"uploads");
},
filename: function(req,file,cb){
cb(null, Date.now() + "-" + file.originalname);
}
});

const upload = multer({storage:storage});

app.post("/upload", upload.single("screenshot"), (req,res)=>{

console.log("Session:", req.body.sessionId);
console.log("Screenshot:", req.file.filename);
console.log("Activity:", req.body.activity);

res.json({
success:true,
file:req.file.filename
});

});

app.listen(3000,()=>{
console.log("Upload server running on port 3000");
});