
import { supabase } from "./connection.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const message = document.getElementById("message");
const button = document.getElementById("loginButton");

const otpModal = document.getElementById("otpModal");
const otpForm = document.getElementById("otpForm");
const otpEmail = document.getElementById("otpEmail");
const otpError = document.getElementById("otpError");
const otpVerifyButton = document.getElementById("otpVerifyButton");
const otpDigits = [...document.querySelectorAll(".otp-digit")];
const otpCancel = document.getElementById("otpCancel");
const otpClose = document.getElementById("otpClose");

let otpSubmitting = false;
let otpCancelled = false;
let verifiedSession = null;

function clearLoginCredentials() {
    if (passwordInput) passwordInput.value = "";
    if (emailInput) emailInput.value = "";
    if (form) form.reset();
}

clearLoginCredentials();

window.addEventListener("pageshow", clearLoginCredentials);
window.addEventListener("pagehide", clearLoginCredentials);

function showMessage(text, isError = false) {
    message.hidden = false;
    message.textContent = text;
    message.classList.toggle("error", isError);
}

function openOtpModal(email) {
    otpEmail.textContent = email;
    otpError.hidden = true;
    otpError.textContent = "";
    otpForm.reset();
    otpModal.hidden = false;
    otpCancelled = false;

    requestAnimationFrame(() => otpDigits[0].focus());
}

function closeOtpModal() {
    if (otpSubmitting) return;

    otpCancelled = true;
    otpModal.hidden = true;
}

function getOtpValue() {
    return otpDigits.map(input => input.value).join("");
}

function setOtpError(text) {
    otpError.textContent = text;
    otpError.hidden = false;
}

otpDigits.forEach((input, index) => {
    input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(-1);

        if (input.value && index < otpDigits.length - 1) {
            otpDigits[index + 1].focus();
        }

        otpError.hidden = true;
    });

    input.addEventListener("keydown", event => {
        if (
            event.key === "Backspace" &&
            !input.value &&
            index > 0
        ) {
            otpDigits[index - 1].focus();
        }

        if (event.key === "ArrowLeft" && index > 0) {
            otpDigits[index - 1].focus();
        }

        if (
            event.key === "ArrowRight" &&
            index < otpDigits.length - 1
        ) {
            otpDigits[index + 1].focus();
        }
    });

    input.addEventListener("paste", event => {
        event.preventDefault();

        const pasted = event.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, 6);

        if (!pasted) return;

        otpDigits.forEach((digit, i) => {
            digit.value = pasted[i] || "";
        });

        otpDigits[Math.min(pasted.length, 5)].focus();
    });
});

otpCancel.addEventListener("click", closeOtpModal);
otpClose.addEventListener("click", closeOtpModal);

otpModal.addEventListener("click", event => {
    if (event.target === otpModal) closeOtpModal();
});


async function getApprovedDestination(userId) {
    // Check whether the authenticated user is an administrator.
    const { data: admin, error: adminError } = await supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

    if (adminError) throw adminError;

    if (admin) return "./admin-dashboard.html";

    // Fetch the user's own profile.
    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, status")
        .eq("id", userId)
        .maybeSingle();

    if (profileError) {
        console.error("Profile lookup failed:", profileError);
        throw new Error(
            "Unable to check your profile. Please try again."
        );
    }

    if (!profile) {
        console.error("No visible profile found for user ID:", userId);
        throw new Error(
            "Your profile could not be found. Please contact the administrator."
        );
    }

    if (profile.status === "pending") {
        throw new Error(
            "Your registration is still pending administrator approval."
        );
    }

    if (profile.status === "rejected") {
        throw new Error(
            "Your registration was rejected. Please contact the administrator."
        );
    }

    // Accept both status values used by your system.
    if (!["active", "approved"].includes(profile.status)) {
        throw new Error("Your account is not active.");
    }

    const rolePages = {
        farmer: "./farmer-dashboard.html",
        buyer: "./buyer-dashboard.html",
        supplier: "./supplier-dashboard.html"
    };

    const destination = rolePages[profile.role];

    if (!destination) {
        throw new Error("Your account role is not recognized.");
    }

    return destination;
}

async function invokeOtpFunction(body) {
    const { data, error } = await supabase.functions.invoke(
        "email-otp-login",
        { body }
    );

    if (error) {
        let details = "";

        try {
            if (error.context && typeof error.context.json === "function") {
                const responseBody = await error.context.clone().json();
                details = responseBody.error || JSON.stringify(responseBody);
            }
        } catch {
            // Keep the original Supabase error if the response is not JSON.
        }

        console.error("OTP function error:", details || error);
        throw new Error(details || error.message);
    }

    if (!data?.success) {
        throw new Error(data?.error || "The OTP request failed.");
    }

    return data;
}

form.addEventListener("submit", async event => {
    event.preventDefault();
    message.hidden = true;

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    button.disabled = true;
    button.textContent = "Sending OTP...";

    let sessionEstablished = false;

    try {
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;

        // STEP 1: Verify password and request an email OTP.
        const requestData = await invokeOtpFunction({
            action: "request",
            email,
            password
        });

        const challengeId = requestData.challengeId;

        if (!challengeId) {
            throw new Error("The server did not return an OTP challenge.");
        }

        passwordInput.value = "";
        showMessage(`A verification code was sent to ${email}.`);

        // STEP 2: Display the OTP modal.
        openOtpModal(email);
        button.textContent = "Waiting for verification...";

        // Wait until the user verifies the code or cancels.
        const otp = await new Promise(resolve => {
            otpForm.onsubmit = async otpEvent => {
                otpEvent.preventDefault();

                const code = getOtpValue();

                if (!/^\d{6}$/.test(code)) {
                    setOtpError("Enter all six digits.");
                    return;
                }

                if (otpSubmitting) return;

                otpSubmitting = true;
                otpVerifyButton.disabled = true;
                otpVerifyButton.textContent = "Verifying...";

                try {
                    // STEP 3: Verify the code while keeping the modal open.
                    const verifyData = await invokeOtpFunction({
                        action: "verify",
                        challengeId,
                        otp: code
                    });

                    if (
                        !verifyData.session?.access_token ||
                        !verifyData.session?.refresh_token
                    ) {
                        throw new Error(
                            "The server did not return a valid login session."
                        );
                    }

                    verifiedSession = verifyData.session;
                    otpModal.hidden = true;
                    resolve(code);
                } catch (error) {
                    setOtpError(
                        error.message || "Invalid code. Please try again."
                    );

                    otpDigits.forEach(input => {
                        input.value = "";
                    });

                    otpDigits[0].focus();
                } finally {
                    otpSubmitting = false;
                    otpVerifyButton.disabled = false;
                    otpVerifyButton.textContent = "Verify code";
                }
            };

            const finishOnCancel = () => {
                if (otpCancelled) resolve(null);
            };

            otpCancel.addEventListener("click", finishOnCancel, { once: true });
            otpClose.addEventListener("click", finishOnCancel, { once: true });
        });

        if (otp === null) {
            showMessage("Verification cancelled. Please log in again.");
            return;
        }

        // STEP 4: Obtain the verified session.
        if (
            !verifiedSession?.access_token ||
            !verifiedSession?.refresh_token
        ) {
            throw new Error("Unable to establish your login session.");
        }

        const { data: sessionData, error: sessionError } =
            await supabase.auth.setSession({
                access_token: verifiedSession.access_token,
                refresh_token: verifiedSession.refresh_token
            });

        if (sessionError) throw sessionError;

        if (!sessionData?.user) {
            throw new Error("Unable to establish your login session.");
        }

        sessionEstablished = true;

        // STEP 5: Check account status and navigate.
        const destination = await getApprovedDestination(
            sessionData.user.id
        );

        window.location.replace(destination);
    } catch (error) {
        console.error("Login error:", error);

        if (sessionEstablished) {
            await supabase.auth.signOut().catch(() => { });
        }

        showMessage(
            error.message || "Unable to log in. Please try again.",
            true
        );
    } finally {
        button.disabled = false;
        button.textContent = "Log in →";
    }
});
