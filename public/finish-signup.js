// Get email stored after OTP verification
const email = localStorage.getItem("userEmail");

// Put email automatically into the email box
document.getElementById("email").value = email;


// When user submits the form
document.getElementById("signupForm").addEventListener("submit", async function(e){

e.preventDefault();

// Get values from form
const firstName = document.getElementById("firstName").value;
const lastName = document.getElementById("lastName").value;
const dob = document.getElementById("dob").value;
const password = document.getElementById("password").value;

try {

const res = await fetch("/api/auth/register",{
method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
firstName,
lastName,
dob,
email,
password
})

});

const data = await res.json();

if(data.success){

alert("Account created successfully!");

// go to login page
window.location.href="login.html";

}
else{

alert(data.message);

}

} catch(err){
    console.error("Registration error:", err);
    // Read raw response to see what server actually returned
    alert("Registration failed: " + err.message);
}

});

const passwordInput = document.getElementById("password");
const passwordRules = document.getElementById("passwordRules");
const strengthText = document.getElementById("strengthText");

const rule2 = document.getElementById("rule2");
const rule3 = document.getElementById("rule3");

// Show rules when password clicked
passwordInput.addEventListener("focus", () => {

passwordRules.style.display = "block";

});

// Check password strength
passwordInput.addEventListener("input", () => {

const password = passwordInput.value;

let strength = "Weak";

if(password.length >= 8){
rule2.style.color = "green";
strength = "Medium";
}else{
rule2.style.color = "red";
}

if(/[0-9!@#$%^&*]/.test(password)){
rule3.style.color = "green";
strength = "Strong";
}else{
rule3.style.color = "red";
}

strengthText.innerText = strength;

});