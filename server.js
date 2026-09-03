const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://gaming-garden.onrender.com",
        methods: ["GET", "POST,"]
    });

// App configuration
const PORT = process.env.PORT || 3000;
const VISITOR_CODE = "00902";
const OWNER_CODE = "1720107";

let isSiteShutdown = false;
let onlineUsers = {}; // Tracks socketId -> { name, role }
let bannedNames = new Set();

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    // 1. Instantly alert connections if global lock is on
    if (isSiteShutdown) {
        socket.emit('site-blocked');
    }

    // 2. Handle Login Verification
    socket.on('verify-login', ({ role, code, name }) => {
        if (isSiteShutdown && role !== 'Owner') {
            socket.emit('site-blocked');
            return;
        }

        if (bannedNames.has(name) && role !== 'Owner') {
            socket.emit('login-error', 'You have been banned from this site.');
            return;
        }

        if (role === 'Visitor' && code === VISITOR_CODE) {
            onlineUsers[socket.id] = { name, role: 'Visitor' };
            socket.emit('login-success', { role, name, isSiteShutdown });
            updateAdminDashboard();
        } else if (role === 'Owner' && code === OWNER_CODE) {
            onlineUsers[socket.id] = { name, role: 'Owner' };
            socket.emit('login-success', { role, name, isSiteShutdown });
            updateAdminDashboard();
        } else {
            socket.emit('login-error', 'Invalid security code.');
        }
    });

    // 3. Admin Tools: Send real-time dashboard data to owners
    function updateAdminDashboard() {
        const usersArray = Object.entries(onlineUsers).map(([id, data]) => ({
            id,
            name: data.name,
            role: data.role
        }));
        
        for (let socketId in onlineUsers) {
            if (onlineUsers[socketId].role === 'Owner') {
                io.to(socketId).emit('update-users', usersArray);
            }
        }
    }

    // 4. Admin Tools: Ban Specific Visitor
    socket.on('ban-user', (targetSocketId) => {
        if (onlineUsers[socket.id]?.role === 'Owner') {
            const targetUser = onlineUsers[targetSocketId];
            if (targetUser && targetUser.role !== 'Owner') {
                bannedNames.add(targetUser.name);
                io.to(targetSocketId).emit('site-blocked');
                delete onlineUsers[targetSocketId];
                updateAdminDashboard();
            }
        }
    });

    // 5. Admin Tools: Shutdown Entire Portal
    socket.on('shutdown-site', () => {
        if (onlineUsers[socket.id]?.role === 'Owner') {
            isSiteShutdown = true;
            io.emit('shutdown-status-changed', true);
            // Kick out all active online visitors immediately
            for (let id in onlineUsers) {
                if (onlineUsers[id].role !== 'Owner') {
                    io.to(id).emit('site-blocked');
                    delete onlineUsers[id];
                }
            }
            updateAdminDashboard();
        }
    });

    // 6. Admin Tools: Restore Site Back Online
    socket.on('restore-site', () => {
        if (onlineUsers[socket.id]?.role === 'Owner') {
            isSiteShutdown = false;
            io.emit('shutdown-status-changed', false);
            updateAdminDashboard();
        }
    });

    // 7. Cleanup on Disconnect
    socket.on('disconnect', () => {
        delete onlineUsers[socket.id];
        updateAdminDashboard();
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
