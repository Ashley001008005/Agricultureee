import { supabase } from "./connection.js";

const form = document.getElementById("signupForm");
const message = document.getElementById("message");
const button = document.getElementById("signupButton");

function showMessage(text, error = false) {
    if (!message) return;

    message.hidden = false;
    message.textContent = text;
    message.classList.toggle("error", error);
}

function value(id) {
    return document.getElementById(id)?.value.trim() ?? "";
}

// Uses the dropdown script's helper first; falls back to reading the DOM.
function selectedCrops() {
    if (typeof window.getSelectedTanikalaCrops === "function") {
        return window.getSelectedTanikalaCrops().filter(Boolean);
    }

    const listed = Array.from(
        document.querySelectorAll('#cropPicker input[name="crops"]:checked')
    )
        .map(input => input.value.trim())
        .filter(Boolean);

    const otherCheckbox = document.getElementById("otherCropCheckbox");
    const otherInput = document.getElementById("otherCropInput");

    const custom = otherCheckbox?.checked
        ? (otherInput?.value ?? "")
            .split(",")
            .map(crop => crop.trim())
            .filter(Boolean)
        : [];

    return [...new Set([...listed, ...custom])];
}

function getFile(id) {
    return document.getElementById(id)?.files?.[0] ?? null;
}

// key = field name sent to the server, label = text shown to the user
function appendValue(data, key, id) {
    data.append(key, value(id));
}

function appendFile(data, key, id, label, required = true) {
    const file = getFile(id);

    if (!file && required) {
        throw new Error(`Please upload your ${label}.`);
    }

    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            throw new Error(`${label} must be 5 MB or smaller.`);
        }

        const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];

        if (!allowedTypes.includes(file.type)) {
            throw new Error(`${label} must be a PDF, JPG, or PNG.`);
        }

        data.append(key, file, file.name);
    }
}


async function submitRegistration(data) {
    const { data: result, error } =
        await supabase.functions.invoke("register-applicant", {
            body: data
        });

    if (error) {
        console.error("Edge Function error:", error);

        let details = error.message || "Registration request failed.";

        try {
            if (error.context) {
                const response = await error.context.clone().text();

                console.error("Edge Function response:", response);

                if (response) {
                    try {
                        const parsed = JSON.parse(response);
                        details = parsed.error || parsed.message || response;
                    } catch {
                        details = response;
                    }
                }
            }
        } catch (readError) {
            console.error("Could not read error response:", readError);
        }

        throw new Error(details);
    }

    if (!result?.success) {
        console.error("Registration result:", result);
        throw new Error(
            result?.error || "Registration could not be completed."
        );
    }

    return result;
}


if (!form) {
    console.error('Signup form with ID "signupForm" was not found.');
} else {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (message) message.hidden = true;

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const fullName = value("fullName");
        const email = value("email").toLowerCase();
        const password = document.getElementById("password")?.value ?? "";
        const confirmPassword =
            document.getElementById("confirmPassword")?.value ?? "";
        const role = value("role");

        const strongPassword =
            password.length >= 12 &&
            /[a-z]/.test(password) &&
            /[A-Z]/.test(password) &&
            /\d/.test(password) &&
            /[^A-Za-z0-9]/.test(password);

        if (!strongPassword) {
            showMessage(
                "Password must be at least 12 characters and include " +
                "a lowercase letter, an uppercase letter, a number, " +
                "and a symbol.",
                true
            );
            return;
        }

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.", true);
            return;
        }

        if (!["farmer", "buyer", "supplier"].includes(role)) {
            showMessage("Please select a valid account type.", true);
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Submitting registration...";
        }

        try {
            const data = new FormData();

            // Shared account information
            data.append("fullName", fullName);
            data.append("email", email);
            data.append("password", password);
            appendValue(data, "phone", "phone");
            appendValue(data, "address", "address");
            data.append("role", role);

            if (role === "farmer") {
                appendValue(data, "farmName", "farmName");
                appendValue(data, "farmLocation", "farmLocation");

                const crops = selectedCrops();

                if (crops.length === 0) {
                    throw new Error("Please select at least one crop.");
                }

                data.append("crops", JSON.stringify(crops));

                appendFile(data, "farmerId", "farmerId", "valid ID");
                appendFile(data, "farmProof", "farmProof", "proof of farm");
            }

            if (role === "buyer") {
                appendValue(data, "buyerType", "buyerType");
                // Server expects "businessName"
                appendValue(data, "businessName", "buyerBusinessName");
                appendValue(data, "buyerProducts", "buyerProducts");

                appendFile(data, "buyerId", "buyerId", "valid ID");

                if (value("buyerType") === "business") {
                    appendFile(
                        data,
                        "buyerPermit",
                        "buyerPermit",
                        "business permit"
                    );
                }
            }

            if (role === "supplier") {
                // Server expects "businessName" and "businessAddress"
                appendValue(data, "businessName", "supplierName");
                appendValue(data, "businessAddress", "supplierAddress");
                appendValue(data, "productsSupplied", "productsSupplied");

                appendFile(data, "supplierId", "supplierId", "valid ID");
                appendFile(
                    data,
                    "businessPermit",
                    "supplierPermit",
                    "business permit"
                );
            }

            const result = await submitRegistration(data);

            showMessage(
                result.message ||
                "Registration submitted successfully. " +
                "Your application is pending administrator review."
            );

            form.reset();
            // Reset the crop picker summary after form.reset()
            document.getElementById("clearCrops")?.click();
        } catch (error) {
            console.error("Signup failed:", error);

            showMessage(
                error.message || "Registration failed. Please try again.",
                true
            );
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Create Account";
            }
        }
    });
}