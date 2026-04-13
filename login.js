const LOGIN_URL = "https://vajobmarketplace.com/wp-json/worktracker/v1/login"

const btn = document.getElementById("loginBtn")

const toggle = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");

toggle.addEventListener("click", ()=>{
  if(passwordInput.type === "password"){
    passwordInput.type = "text";
    toggle.innerText = "🙈";
  }else{
    passwordInput.type = "password";
    toggle.innerText = "👁";
  }
});

btn.addEventListener("click", async ()=>{

  btn.disabled = true;
  btn.innerText = "Logging in...";

let email = document.getElementById("email").value.trim();
let password = document.getElementById("password").value;

// ✅ FIX: Basic validation bago mag-send
if(!email || !password){
  btn.disabled = false;
  btn.innerText = "Login";
  document.getElementById("status").innerText = "❌ Please enter email and password.";
  return;
}

try{

    // 🔥 DITO MO ILALAGAY
    const res = await fetch(LOGIN_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body: JSON.stringify({
        username: email,
        password: password
      })
    })

    const data = await res.json()

    console.log("LOGIN RESPONSE:", data)

    if(data.error){
      throw new Error(data.error)
    }

    if(!data.token){
      throw new Error("No token received")
    }

    // ✅ success
    btn.innerText = "Success...";

    window.api.send("login-success",{
      token: data.token,
      user: data.user_id,
      name: data.display_name || email,
      email: data.email || email
    })

  }catch(err){
    btn.disabled = false;
    btn.innerText = "Login";

    document.getElementById("status").innerText =
    "❌ " + err.message;
  }

})