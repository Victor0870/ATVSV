:::writing
import {
auth,
db,
onAuthStateChanged,
signOut,
doc,
getDoc,
collection,
getDocs
} from "./firebase-config.js";

let submissions = [];
let trendChart = null;

document.addEventListener("DOMContentLoaded", init);

function init() {
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", logout);
observeAuth();
}

function observeAuth() {
onAuthStateChanged(auth, async (user) => {
if (!user) {
location.href = "./index.html";
return;
}

const userDoc = await getDoc(doc(db, "users", user.uid));
if (!userDoc.exists()) {
  alert("Không tìm thấy hồ sơ user");
  return;
}

const profile = userDoc.data();

if (!["admin", "manager"].includes(profile.role)) {
  alert("Bạn không có quyền truy cập dashboard");
  location.href = "./index.html";
  return;
}

await loadDashboard();
});
}

async function loadDashboard() {
try {
const snap = await getDocs(collection(db, "submissions"));
submissions = snap.docs.map((d) => d.data());

renderStats();
renderTrend();
renderNgTable();
} catch (err) {
console.error(err);
alert("Lỗi khi tải dữ liệu dashboard");
}

const loader = document.getElementById("pageLoader");
if (loader) loader.style.display = "none";
}

function renderStats() {
let ok = 0;
let ng = 0;
let na = 0;

submissions.forEach((s) => {
(s.answers || []).forEach((a) => {
if (a.result === "OK") ok++;
if (a.result === "NG") ng++;
if (a.result === "N/A") na++;
});
});

document.getElementById("statTotalSubmissions").textContent =
submissions.length;
document.getElementById("statTotalOk").textContent = ok;
document.getElementById("statTotalNg").textContent = ng;
document.getElementById("statTotalNa").textContent = na;
}

function renderTrend() {
const map = {};

submissions.forEach((s) => {
const date = (s.createdAtText || "").split(" ")[0];
if (!date) return;

if (!map[date]) map[date] = 0;
map[date]++;
});

const labels = Object.keys(map).slice(-7);
const data = labels.map((l) => map[l]);

const ctx = document.getElementById("trendChart");

if (trendChart) trendChart.destroy();

trendChart = new Chart(ctx, {
type: "line",
data: {
labels,
datasets: [
{
label: "Báo cáo",
data,
borderColor: "#ed1c24",
backgroundColor: "rgba(237,28,36,0.1)",
tension: 0.3,
fill: true
}
]
},
options: {
responsive: true,
plugins: {
legend: { display: false }
},
scales: {
y: {
beginAtZero: true,
ticks: { precision: 0 }
}
}
}
});
}

function renderNgTable() {
const tbody = document.getElementById("ngTableBody");
let rows = "";

submissions.forEach((s) => {
(s.answers || []).forEach((a) => {
if (a.result !== "NG") return;

  const img = a.images?.[0]?.url || "";

  rows += `
<tr class="border-b"> <td class="p-2">${s.submissionId || "-"}</td> <td class="p-2">${s.hoTen || "-"}</td> <td class="p-2">${a.question || ""}</td> <td class="p-2">${a.note || ""}</td> <td class="p-2 text-center"> ${ img ? `<img src="${img}" class="h-10 mx-auto cursor-pointer" onclick="openImage('${img}')">` : "-" } </td> <td class="p-2 text-center text-red-600 font-semibold"> NG </td> </tr> `; }); });
if (!rows) {
rows = `<tr>

<td colspan="6" class="text-center py-6 text-gray-400"> Không có lỗi NG </td> </tr>`; }
tbody.innerHTML = rows;
}

window.openImage = function (src) {
const modal = document.getElementById("imageModal");
const img = document.getElementById("imagePreview");

img.src = src;
modal.classList.remove("hidden");
modal.classList.add("flex");

modal.onclick = () => {
modal.classList.add("hidden");
modal.classList.remove("flex");
};
};

async function logout() {
await signOut(auth);
location.href = "./index.html";
}
:::
