const phoneForm = document.getElementById("phoneForm");

phoneForm.addEventListener("submit", async function(e){

e.preventDefault();

const phone = document.getElementById("phone").value;

const response = await fetch("/api/auth/send-otp",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({ phone })
});

const data = await response.json();

if(data.success){

alert("OTP Sent");
document.getElementById("otpSection").style.display = "block";

}else{
alert("Failed to send OTP");
}

});

document.getElementById("verifyBtn").addEventListener("click", async function(){

const phone = document.getElementById("phone").value;
const otp = document.getElementById("otp").value;

const response = await fetch("/api/auth/verify-otp",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({ phone, otp })
});

const data = await response.json();

if(data.success){

alert("Phone verified successfully");
window.location.href = "index.html";

}else{

alert("Invalid OTP");

}

});
