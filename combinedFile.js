
//--- File: /home/luan_ngo/web/events/public/index.html ---

<html lang="en">

<head>
    <title>Event Management</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    
    <script>
        
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    </script>
    
    <link href="https:
    <link href="https:
    <link href="/styles.css" rel="stylesheet">
</head>

<body class="min-h-screen bg-base-100">
    
    <header class="sticky top-0 z-50 bg-base-100 border-b border-base-200">
        <div class="container mx-auto px-4 py-3">
            <h1 class="text-2xl font-bold text-base-content">Event Management</h1>
        </div>
        
        <div class="hidden lg:flex fixed top-4 right-4 gap-2 z-50">
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Contacts">
                <i class="bi bi-address-book text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Event Details">
                <i class="bi bi-info-circle text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Messages">
                <i class="bi bi-envelope text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Actions">
                <i class="bi bi-list text-xl"></i>
            </button>
            <button class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Calendar">
                <i class="bi bi-calendar text-xl"></i>
            </button>
            <button onclick="window.user_settings_modal.showModal()"
                class="btn btn-ghost btn-circle tooltip tooltip-left" data-tip="Settings">
                <i class="bi bi-gear text-xl"></i>
            </button>
        </div>
    </header>

    
    <div class="container mx-auto px-4 py-6">
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            <aside class="lg:col-span-1">
                <div class="sticky top-20">
                    <div class="card bg-base-100 shadow-lg">
                        <div class="card-body p-4">
                            <div class="flex justify-between items-center">
                                <h2 class="card-title text-lg">Contacts</h2>
                                <div class="dropdown dropdown-end">
                                    <button tabindex="0" class="btn btn-ghost btn-sm btn-square tooltip"
                                        data-tip="Filter">
                                        <i class="bi bi-filter"></i>
                                    </button>
                                    <ul tabindex="0"
                                        class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
                                        <li><a href="#" id="sortByName">Sort By Name</a></li>
                                        <li><a href="#" id="sortByDateBooked">Sort By Date Booked</a></li>
                                        <li><a href="#" id="sortByEventDate">Sort By Event Date</a></li>
                                        <li class="mt-2">
                                            <input type="text" class="input input-bordered w-full" id="searchInput"
                                                placeholder="Search">
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            <div class="divider my-2"></div>
                            <div class="overflow-y-auto max-h-[calc(100vh-200px)]" id="contacts">
                                
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            
            <main class="lg:col-span-3 space-y-6">
                
                
                <section id="info" class="card bg-base-100 shadow-lg">
                    <div class="card-body">
                        <h2 class="card-title text-lg mb-4">Event Details</h2>
                        <div class="space-y-8"> 
                            
                            <div class="space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-person"></i>
                                    Contact Information
                                </h3>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Name</span>
                                        </label>
                                        <input type="text" id="infoName"
                                            class="input input-bordered w-full focus:input-primary">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Phone</span>
                                        </label>
                                        <input type="tel" id="actionsPhone" class="input input-bordered w-full"
                                            pattern="[0-9]{3}-[0-9]{3}-[0-9]{4}">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Email</span>
                                        </label>
                                        <input type="email" id="infoEmail" class="input input-bordered w-full">
                                    </div>
                                </div>
                            </div>

                            
                            <div class="space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-clock"></i>
                                    Event Timing
                                </h3>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Start Time</span>
                                        </label>
                                        <input type="datetime-local" id="infoStartTime"
                                            class="input input-bordered w-full">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">End Time</span>
                                        </label>
                                        <input type="datetime-local" id="infoEndTime"
                                            class="input input-bordered w-full">
                                    </div>
                                </div>
                            </div>

                            
                            <div class="space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-info-circle"></i>
                                    Event Information
                                </h3>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Party Type</span>
                                        </label>
                                        <input type="text" id="infoPartyType" class="input input-bordered w-full">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Expected Attendance</span>
                                        </label>
                                        <input type="number" id="infoAttendance" class="input input-bordered w-full">
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Status</span>
                                        </label>
                                        <select multiple id="infoStatus" class="select select-bordered w-full">
                                            <option value="contractSent">Contract Sent</option>
                                            <option value="depositPaid">Deposit Paid</option>
                                            <option value="reserved">Reserved</option>
                                            <option value="completed">Event Completed</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            
                            <div class="space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-building"></i>
                                    Venue Details
                                </h3>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Room Selection</span>
                                        </label>
                                        <select multiple id="infoRoom" class="select select-bordered w-full">
                                            <option value="Lounge">Lounge</option>
                                            <option value="DiningRoom">Dining Room</option>
                                            <option value="Patio">Patio</option>
                                        </select>
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Services</span>
                                        </label>
                                        <select multiple id="infoServices" class="select select-bordered w-full">
                                            <option value="dj">DJ</option>
                                            <option value="live">Live Band</option>
                                            <option value="bar">Private Bar</option>
                                            <option value="lights">Party Lights</option>
                                            <option value="audio">Audio Equipment</option>
                                            <option value="music">Music</option>
                                            <option value="kareoke">kareoke</option>
                                            <option value="catering">Catering</option>
                                            <option value="drink">Drink Package</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            
                            <div class="space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-currency-dollar"></i>
                                    Financial Details
                                </h3>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Rental Rate</span>
                                        </label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                            <input type="number" id="infoRentalRate"
                                                class="input input-bordered w-full pl-7">
                                        </div>
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Minimum Spend</span>
                                        </label>
                                        <div class="relative">
                                            <span class="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                            <input type="number" id="infoMinSpend"
                                                class="input input-bordered w-full pl-7">
                                        </div>
                                    </div>

                                    <div class="form-control">
                                        <label class="label">
                                            <span class="label-text font-medium">Hourly Rate</span>
                                        </label>
                                        <div class="flex gap-2">
                                            <div class="relative flex-1">
                                                <span class="absolute left-3 top-1/2 -translate-y-1/2">$</span>
                                                <input type="number" id="hourlyRate"
                                                    class="input input-bordered w-full pl-7" value="125">
                                            </div>
                                            <button id="calcRate" class="btn btn-primary tooltip" data-tip="Calculate">
                                                <i class="bi bi-calculator"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            
                            <div class="space-y-4">
                                <h3 class="font-medium text-base flex items-center gap-2 text-primary">
                                    <i class="bi bi-journal-text"></i>
                                    Additional Notes
                                </h3>
                                <div class="form-control">
                                    <textarea id="infoNotes" rows="4" class="textarea textarea-bordered w-full"
                                        placeholder="Enter any additional notes or special requirements..."></textarea>
                                </div>
                            </div>

                            
                            <div class="border-t border-base-300 pt-6 flex flex-wrap gap-4 items-center">
                                <div class="flex flex-wrap gap-2">
                                    <button class="btn btn-primary tooltip" data-tip="Save" id="infoSave">
                                        <i class="bi bi-save"></i>
                                    </button>
                                    <button class="btn btn-secondary tooltip" data-tip="Add Contact"
                                        id="infoAddContact">
                                        <i class="bi bi-person-plus"></i>
                                    </button>
                                    <button class="btn btn-accent tooltip" data-tip="Receipt" id="receipt">
                                        <i class="bi bi-receipt"></i>
                                    </button>
                                    <button class="btn btn-accent tooltip" data-tip="Summarize" id="summarizeEvent">
                                        <i class="bi bi-file-earmark-text"></i>
                                    </button>
                                    <button class="btn btn-accent tooltip" data-tip="Add Deposit Info"
                                        id="generateDeposit">
                                        <i class="bi bi-cash"></i>
                                    </button>
                                    <button class="btn btn-primary tooltip" data-tip="Create Contract"
                                        id="actionsCreateContract">
                                        <i class="bi bi-file-text"></i>
                                    </button>
                                    <button class="btn btn-primary tooltip" data-tip="Email Contract"
                                        id="actionsEmailContract">
                                        <i class="bi bi-envelope"></i>
                                    </button>
                                    <button class="btn btn-primary tooltip" data-tip="Book Calendar"
                                        id="actionsBookCalendar">
                                        <i class="bi bi-calendar-check"></i>
                                    </button>
                                </div>


                            </div>

                            <div id="depositPw" class="text-sm text-base-content/70"></div>
                        </div>
                    </div>
                </section>

                
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    <section id="messages" class="card bg-base-100 shadow-lg h-[75vh]">
                        <div class="card-body flex flex-col">
                            <div class="flex justify-between items-center mb-4">
                                <h2 class="card-title text-lg">Messages</h2>
                                <div class="flex gap-2">
                                    <button class="btn btn-sm gap-2 tooltip tooltip-left" data-tip="Hide Replied Emails"
                                        id="toggleRepliedEmails">
                                        <i class="bi bi-eye-slash"></i>
                                    </button>
                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left"
                                        data-tip="Read Email" id="readAllEmails">
                                        <i class="bi bi-envelope"></i>
                                    </button>
                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left"
                                        data-tip="Summarize" id="summarizeLastEmails">
                                        <i class="bi bi-list-task"></i>
                                    </button>
      
                                    <button class="btn btn-ghost btn-sm btn-square tooltip tooltip-left" data-tip="Get Interac" id="getInterac">
                                        <i class="bi bi-cash-coin"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="overflow-y-auto messages-container">
                                
                            </div>
                        </div>
                    </section>

                    
                    <section id="actions" class="card bg-base-100 shadow-lg">
                        <div class="card-body">
                            <h2 class="card-title text-lg mb-4">Actions & AI Assistant</h2>
                            <div class="flex flex-wrap gap-2 mb-4">

                                <button class="btn btn-secondary tooltip" data-tip="Event AI" id="eventAI">
                                    <i class="bi bi-calendar-plus"></i>
                                </button>
                                <button class="btn btn-secondary tooltip" data-tip="Email AI" id="emailAI">
                                    <i class="bi bi-envelope"></i>
                                </button>
                            </div>

                            
                            <div class="bg-base-200 rounded-lg p-4">
                                
                                <div class="flex justify-between items-center mb-2">
                                    <h3 class="font-bold">AI Conversation</h3>
                                    <button id="maximizeAiResult" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Maximize">
                                        <i class="bi bi-arrows-fullscreen"></i>
                                    </button>
                                </div>
                                <div class="overflow-y-auto h-64 mb-4 bg-base-100 rounded-lg p-2" id="aiResult">
                                </div>
                                <div class="flex items-center gap-2 mb-2">
                                    <h3 class="font-bold">Message</h3>
                                    <button id="toggleButton" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Expand">
                                        <i class="bi bi-arrows-fullscreen"></i>
                                    </button>
                                </div>
                                <div contenteditable="true" style="max-height: 400px; overflow-y: scroll;"
                                    class="bg-base-100 rounded-lg p-2 min-h-[100px] focus:outline-none border border-base-300"
                                    id="aiText">
                                </div>
                                <div class="flex flex-wrap gap-2 mt-4">
                                    <button class="btn btn-accent tooltip" data-tip="Chat" id="actionSendAI">
                                        <i class="bi bi-chat-dots"></i>
                                    </button>
                                    <button class="btn btn-accent tooltip" data-tip="Confirm" id="confirmAI">
                                        <i class="bi bi-check-circle"></i>
                                    </button>
                                    <button id="clearAiText" class="btn btn-ghost btn-xs btn-square tooltip"
                                        data-tip="Clear">
                                        <i class="bi bi-trash"></i>
                                    </button>
                                    <div class="flex items-center gap-2 flex-1">
                                        <input type="text" id="sendMailEmail" class="input input-bordered flex-1"
                                            placeholder="Email">
                                        <input type="text" id="sendMailSubject" class="input input-bordered flex-1"
                                            placeholder="Subject">
                                        <button class="btn btn-primary tooltip" data-tip="Send" id="sendEmail">
                                            <i class="bi bi-send"></i>
                                        </button>
                                    </div>

                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
        <div class="container py-6">
            <section id="calendar" class="card bg-base-100 shadow-lg">
                <div class="card-body">
                    <h2 class="card-title text-lg mb-4">Calendar</h2>
                    <div id="calendarContainer" class="w-full">
                        
                    </div>
                </div>
            </section>
        </div>
    </div>


    <div class="md:hidden btm-nav "> 
        <button onclick="scrollToSection('contacts')" class="tooltip tooltip-top" data-tip="Contacts">
            <i class="bi bi-people text-xl"></i> 
        </button>
        <button onclick="scrollToSection('info')" class="tooltip tooltip-top" data-tip="Event Details">
            <i class="bi bi-info-circle text-xl"></i>
        </button>
        <button onclick="scrollToSection('messages')" class="tooltip tooltip-top" data-tip="Messages">
            <i class="bi bi-envelope text-xl"></i>
        </button>
        <button onclick="scrollToSection('actions')" class="tooltip tooltip-top" data-tip="Actions">
            <i class="bi bi-list text-xl"></i>
        </button>
        <button onclick="scrollToSection('calendar')" class="tooltip tooltip-top" data-tip="Calendar">
            <i class="bi bi-calendar text-xl"></i>
        </button>
        <button onclick="window.user_settings_modal.showModal()" class="tooltip tooltip-top" data-tip="Settings">
            <i class="bi bi-gear text-xl"></i>
        </button>
    </div>
    <dialog id="maximize_content_modal" class="modal">
        <div class="modal-box w-11/12 max-w-7xl h-[90vh]"> 
            <h3 class="font-bold text-lg mb-4" id="maximizeModalTitle">Content View</h3>
            <div id="maximizedContent" class="overflow-y-auto max-h-[calc(100%-8rem)] bg-base-100 rounded-lg p-4"
                contenteditable="false">
                
            </div>
            <div class="modal-action">
                <form method="dialog">
                    <button class="btn">Close</button>
                </form>
            </div>
        </div>
    </dialog>
    
    <dialog id="user_settings_modal" class="modal">
        <div class="modal-box">
            <h2 class="text-xl font-semibold mb-4">User Settings</h2>

            
            <div class="mb-6">
                <h3 class="font-bold mb-2">Google Account Access</h3>
                <p class="text-sm text-base-content/70 mb-2">
                    Connect your Google account to access emails and calendar events.
                </p>
                <button id="googleOAuthButton" class="btn btn-primary btn-block gap-2 mb-2">
                    <i class="bi bi-google"></i>
                    Sign in with Google
                </button>
                <div id="connectedEmail" class="text-sm text-success"></div>
            </div>

            
            <div class="mb-6">
                <h3 class="font-bold mb-2">Theme</h3>
                <select class="select select-bordered w-full" id="themeSelect">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                </select>
            </div>

            
            
            <div class="mb-6">
                <h3 class="font-bold mb-2">AI Background Information</h3>
                <p class="text-sm text-base-content/70 mb-2">
                    This information will be used to provide context to the AI about your venue, services, and policies.
                </p>
                <div class="form-control">
                    <textarea id="backgroundInfo" class="textarea textarea-bordered min-h-[200px]"
                        placeholder="Enter venue details, services, policies, and any other relevant information the AI should know about..."></textarea>
                </div>
                <div id="saveStatus" class="alert mt-2 hidden">
                    <i class="bi bi-info-circle"></i>
                    <span id="saveStatusText"></span>
                </div>
                <button id="saveBackgroundInfo" class="btn btn-primary gap-2 mt-4">
                    <i class="bi bi-save"></i>
                    Save Background Info
                </button>
            </div>
            
            <div class="mb-6">
                <h3 class="font-bold mb-2">Account</h3>
                <button id="logoutButton" class="btn btn-outline btn-error btn-block gap-2">
                    <i class="bi bi-box-arrow-right"></i>
                    Logout
                </button>
            </div>

            <div class="modal-action">
                <form method="dialog">
                    <button class="btn">Close</button>
                </form>
            </div>
        </div>
    </dialog>

    
    <script src="https:
    <script src="https:
        integrity="sha512-WFN04846sdKMIP5LKNphMaWzU7YpMyCU245etK3g/2ARYbPK9Ub18eG+ljU96qKRCWh+quCY7yefSmlkQw1ANQ=="
        crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https:
    <script
        src="https:
        integrity="sha512-s932Fui209TZcBY5LqdHKbANLKNneRzBib2GE3HkZUQtoWY3LBUN2kaaZDK7+8z8WnFY23TPUNsDmIAY1AplPg=="
        crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https:
    <script src="https:
    <script src="https:

    <script src="/EmailEventUpdater.js"></script>
    <script src="/EmailProcessor.js"></script>
    <script src="/ReceiptManager.js"></script>
    <script src="/calendar.js"></script>
    <script type="module">
        import { EventManageApp } from '/scripts.js';
        window.app = new EventManageApp();

        
        const themeSelect = document.getElementById('themeSelect');
        
        themeSelect.value = localStorage.getItem('theme') || 'dark';

        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
        });
        document.addEventListener('DOMContentLoaded', function () {
            window.app.init();
        });
    </script>
</body>

</html>

//--- File: /home/luan_ngo/web/events/public/calendar.js ---
class Calendar {
    constructor(containerId) {
        this.containerId = containerId;
        this.currentDate = new Date();
        this.events = [];
        this.weatherData = new Map();
        $(document).ready(() => this.initialize());
    }
    
    showModal(eventDetails) {
        
        eventDetails.labelEndTime = eventDetails.labelEndTime || eventDetails.endTime;

        const modalHTML = `
        <div class="modal fade" id="eventModal" tabindex="-1" aria-labelledby="eventModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="eventModalLabel">${eventDetails.title}</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p><strong>Room:</strong> ${eventDetails.room}</p>
                        <p><strong>Time:</strong> ${moment(eventDetails.startTime).format('hh:mm')} - ${moment(eventDetails.labelEndTime).format('hh:mm')}</p>
                        <p><strong>Description:</strong> ${eventDetails.description}</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" id="bookNowButton">Book Now</button>
                    </div>
                </div>
            </div>
        </div>
        `;

        
        $('body').append(modalHTML);
        $('#eventModal').modal('show');

        
        $('#eventModal').on('hidden.bs.modal', function () {
            $('#eventModal').remove();
        });

        
        $('#bookNowButton').click(() => {
            alert('Book now action not implemented.');
            $('#eventModal').modal('hide'); 
        });
    }

    
    eventClickHandler(eventId) {
        const eventDetails = this.events.find(event => event.id === eventId);
        if (eventDetails) {
            this.showModal(eventDetails);
        }
    }
    constructHTML() {
        const html = `
        <div class="calendar-header">
            <h4 class="calendar-month-year">
                <span id="month" class="calendar-month"></span>
                <span id="year" class="calendar-year"></span>
                <div class="calendar-nav" style="display: inline-block;">
                    <a id="left" href="#" class="btn btn-outline-primary btn-sm" data-tip="tooltip" title="Previous Month">
                        <i class="bi bi-chevron-left"></i>
                    </a>
                    <a id="right" href="#" class="btn btn-outline-primary btn-sm" data-tip="tooltip" title="Next Month">
                        <i class="bi bi-chevron-right"></i>
                    </a>
                </div>
            </h4>
        </div>
        <div class="row">
            <div class="col-12">
                <table class="table table-bordered">
                    
                </table>
            </div>
        </div>
        `;
        $('#' + this.containerId).html(html);
    }

    loadEvents(events) {
        this.events = events;
        this.refreshCalendar();
    }

    refreshCalendar() {
        this.generateCalendar(this.currentDate);
    }
    getWMOIcon(code) {
        
        const weatherCodes = {
            0: { icon: 'bi-sun-fill', class: 'text-yellow-500' },  
            1: { icon: 'bi-sun-fill', class: 'text-yellow-500' },  
            2: { icon: 'bi-cloud-sun-fill', class: 'text-gray-500' },  
            3: { icon: 'bi-cloud-fill', class: 'text-gray-500' },  

            
            45: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },  
            48: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },  

            
            51: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  
            53: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  
            55: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  

            
            56: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  
            57: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  

            
            61: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            63: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            65: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },  

            
            66: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  
            67: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  

            
            71: { icon: 'bi-snow', class: 'text-blue-200' },  
            73: { icon: 'bi-snow', class: 'text-blue-200' },  
            75: { icon: 'bi-snow-fill', class: 'text-blue-200' },  

            
            77: { icon: 'bi-snow', class: 'text-blue-200' },  

            
            80: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            81: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  
            82: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },  

            
            85: { icon: 'bi-snow', class: 'text-blue-200' },  
            86: { icon: 'bi-snow-fill', class: 'text-blue-200' },  

            
            95: { icon: 'bi-cloud-lightning-fill', class: 'text-yellow-600' },  
            96: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' },  
            99: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' }   
        };

        return weatherCodes[code] || { icon: 'bi-question-circle', class: 'text-gray-500' };
    }

    async fetchWeatherData() {
        try {
            const response = await fetch('https:
            const data = await response.json();

            
            data.daily.time.forEach((date, index) => {
                this.weatherData.set(date, {
                    weatherCode: data.daily.weather_code[index],
                    maxTemp: Math.round(data.daily.temperature_2m_max[index]),
                    minTemp: Math.round(data.daily.temperature_2m_min[index])
                });
            });
        } catch (error) {
            console.error('Error fetching weather data:', error);
        }
    }

    generateCalendar(d) {
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
        const totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let html = '<table class="table calendar"><thead><tr>';

        for (let i = 0; i < 7; i++) {
            html += `<th>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</th>`;
        }
        html += '</tr></thead><tbody><tr>';

        
        for (let i = 0; i < firstDayOfMonth; i++) {
            html += '<td></td>';
        }

        for (let day = 1; day <= totalDays; day++) {
            const dayDate = new Date(d.getFullYear(), d.getMonth(), day);
            const dateStr = moment(dayDate).format('YYYY-MM-DD');
            const weather = this.weatherData.get(dateStr);

            if ((day + firstDayOfMonth - 1) % 7 === 0 && day > 1) {
                html += '</tr><tr>';
            }

            html += `
                <td class="day relative" data-date="${dateStr}">
                    <div class="flex justify-between items-start">
                        <span class="font-bold">${day}</span>
                        ${weather ? `
                            <div class="weather-info text-xs flex flex-col items-end">
                                <div class="flex items-center gap-1">
                                    <i class="bi ${this.getWMOIcon(weather.weatherCode).icon} ${this.getWMOIcon(weather.weatherCode).class}"></i>
                                </div>
                                <div class="text-right">
                                    <span class="text-red-500">${weather.maxTemp}°</span>
                                    <span class="text-blue-500">${weather.minTemp}°</span>
                                </div>
                            </div>
                        ` : ''}
                    </div>`;

            
            const eventsForDay = this.events.filter(event => {
                const eventStart = new Date(event.startTime).setHours(0, 0, 0, 0);
                const eventEnd = new Date(event.endTime).setHours(23, 59, 59, 999);
                return dayDate >= eventStart && dayDate <= eventEnd;
            });

            eventsForDay.forEach(event => {
                html += `
                    <div class="event-bar mt-2" data-eventid="${event.id}" title="${event.title}">
                        ${event.title}
                    </div>`;
            });

            html += `</td>`;
        }

        
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth(), totalDays).getDay();
        for (let i = lastDayOfMonth; i < 6; i++) {
            html += '<td></td>';
        }

        html += '</tr></tbody></table>';
        $('#' + this.containerId + ' .col-12').html(html);

        
        $('.event-bar').click((e) => {
            const eventId = $(e.target).data('eventid');
            this.eventClickHandler(eventId);
        });

        this.updateMonthYear(d);
    }

    updateMonthYear(d) {
        $('#month', '#' + this.containerId).text(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]);
        $('#year', '#' + this.containerId).text(d.getFullYear());

        $('#left', '#' + this.containerId).off('click').click((e) => {
            e.preventDefault();
            this.changeMonth(-1);
        });

        $('#right', '#' + this.containerId).off('click').click((e) => {
            e.preventDefault();
            this.changeMonth(1);
        });
    }

    async changeMonth(offset) {
        this.currentDate.setMonth(this.currentDate.getMonth() + offset);
        await this.fetchWeatherData(); 
        this.refreshCalendar();
    }

    async initialize() {
        await this.fetchWeatherData();
        this.constructHTML();
        this.refreshCalendar();
    }
}








//--- File: /home/luan_ngo/web/events/public/ReceiptManager.js ---
class ReceiptManager {
  constructor(rentalFee) {
    this.items = [];
    this.tipPercent = 0;
    this.ccSurcharge = false;
    this.taxRate = 0.13;
    this.rentalFee = rentalFee || 0;

    this.createDialog();
    this.initializeEventListeners();

    
    this.dialog.showModal();
  }
  createDialog() {
    const dialogHtml = `
        <dialog id="receiptDialog" class="modal">
            <div class="modal-box max-w-2xl">
                <div id="receiptContent">
                    
                    <div class="text-center space-y-2 mt-6">
                        <p class="text-sm">I say taco, you say taco!</p>
                        <h1 class="font-bold text-2xl">TacoTaco</h1>
                        <p class="text-sm">319 Augusta Ave. Toronto ON M5T2M2</p>
                    </div>

                    
                    <div class="space-y-4 mt-6">
                        <table class="table w-full" id="receiptItems">
                            <thead>
                                <tr>
                                    <th class="text-left">Item</th>
                                    <th class="text-right w-20">Qty</th>
                                    <th class="text-right w-24">Price</th>
                                    <th class="text-right w-24">Total</th>
                                    <th class="w-12"></th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>

                    
                    <div class="space-y-2 border-t pt-4 mt-8">
                        <div class="flex justify-between">
                            <span>Subtotal</span>
                            <span id="subtotalAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between">
                            <span>Tip (<span id="tipPercentDisplay">0</span>%)</span>
                            <span id="tipAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between items-center">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <span>CC Surcharge <span id="ccLabel"></span></span>
                                <input type="checkbox" id="ccSurcharge" class="checkbox checkbox-sm print:hidden">
                            </label>
                            <span id="surchargeAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between">
                            <span>Tax (13%)</span>
                            <span id="taxAmount">$0.00</span>
                        </div>

                        <div class="flex justify-between font-bold text-lg border-t pt-2">
                            <span>Total</span>
                            <span id="totalAmount">$0.00</span>
                        </div>
                    </div>

                    
                    <div class="text-center text-sm space-y-1 mt-8">
                        <div>eattaco.ca@tacotacoto</div>
                        <div>GST/HST #: 773762067RT0001</div>
                    </div>
                </div> 

                
                <div class="border-t mt-8 pt-4 print:hidden">
                    <h3 class="font-semibold text-lg mb-4">Receipt Controls</h3>

                    
                    <div class="mb-4">
                        <div class="flex items-center gap-2">
                            <span class="w-24">Tip Amount:</span>
                            <select id="tipPercent" class="select select-bordered select-sm">
                                <option value="0">0%</option>
                                <option value="10">10%</option>
                                <option value="15">15%</option>
                                <option value="18">18%</option>
                                <option value="20">20%</option>
                            </select>
                        </div>
                    </div>

                    
                    <div class="overflow-x-auto">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th class="text-left">Item</th>
                                    <th class="text-left">Quantity</th>
                                    <th class="text-left">Price</th>
                                    <th></th> 
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>
                                        <input type="text" id="newItemName" placeholder="Item name" value="Rental"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td>
                                        <input type="number" id="newItemQty" placeholder="Qty" value="1" min="1"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td>
                                        <input type="number" id="newItemPrice" placeholder="Price" step="0.01"
                                               value="${((this.rentalFee/2)/1.13).toFixed(2)}"
                                               class="input input-bordered input-sm w-full">
                                    </td>
                                    <td class="text-center">
                                        <button id="addItemBtn" class="btn btn-sm btn-ghost btn-square text-success">
                                            <span class="font-bold text-lg">+</span>
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                
                <div class="modal-action mt-6 print:hidden">
                    <button id="downloadReceiptBtn" class="btn btn-success gap-2">
                        Save as Image
                    </button>
                    <button id="printReceiptBtn" class="btn btn-primary">
                        Print
                    </button>
                    <form method="dialog">
                        <button class="btn">Close</button>
                    </form>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    `;

    document.body.insertAdjacentHTML('beforeend', dialogHtml);
    this.dialog = document.getElementById('receiptDialog');
}


  
  initializeEventListeners() {
    
    document.getElementById('addItemBtn').addEventListener('click', () => {
      this.handleAddItem();
    });

    
    document.getElementById('newItemPrice').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleAddItem();
      }
    });

    document.getElementById('tipPercent').addEventListener('change', (e) => {
      this.tipPercent = parseInt(e.target.value);
      document.getElementById('tipPercentDisplay').textContent = this.tipPercent;
      this.updateTotals();
    });
    
    document.getElementById('ccSurcharge').addEventListener('change', (e) => {
      this.ccSurcharge = e.target.checked;
      document.getElementById('ccLabel').textContent = this.ccSurcharge ? '(2.4%)' : '';
      this.updateTotals();
    });

    
    document.getElementById('printReceiptBtn').addEventListener('click', () => {
      window.print();
    });

    
    document.getElementById('downloadReceiptBtn').addEventListener('click', () => {
      this.downloadAsImage();
    });

    
    this.dialog.addEventListener('close', () => {
      this.dialog.remove();
      delete window.currentReceipt;
    });
  }

  handleAddItem() {
    const nameInput = document.getElementById('newItemName');
    const qtyInput = document.getElementById('newItemQty');
    const priceInput = document.getElementById('newItemPrice');

    const name = nameInput.value;
    const quantity = parseInt(qtyInput.value);
    const price = parseFloat(priceInput.value);

    if (name && quantity > 0 && price >= 0) {
      this.addItem({ name, quantity, price });
      nameInput.value = 'Rental';
      qtyInput.value = '1';
      priceInput.value = this.rentalFee.toFixed(2);
      priceInput.focus();
    }
  }

  addItem({ name, quantity, price }) {
    const item = { name, quantity, price, id: Date.now() };
    this.items.push(item);
    this.renderItems();
    this.updateTotals();
  }

  removeItem(itemId) {
    this.items = this.items.filter(item => item.id !== itemId);
    this.renderItems();
    this.updateTotals();
  }

  renderItems() {
    const tbody = document.querySelector('#receiptItems tbody');
    const itemsHtml = this.items.map(item => `
          <tr class="border-b">
              <td class="p-2">${item.name}</td>
              <td class="text-right p-2">${item.quantity}</td>
              <td class="text-right p-2">$${item.price.toFixed(2)}</td>
              <td class="text-right p-2">$${(item.quantity * item.price).toFixed(2)}</td>
              <td class="text-right p-2 print:hidden">
                  <button onclick="window.currentReceipt.removeItem(${item.id})" class="text-red-600 hover:text-red-700">
                      <i class="bi bi-x"></i>
                  </button>
              </td>
          </tr>
      `).join('');

    tbody.innerHTML = itemsHtml;
  }

  updateTotals() {
    const subtotal = this.items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const tipableAmount = this.items
      .filter(item => item.name.toLowerCase() !== 'rental')
      .reduce((sum, item) => sum + (item.quantity * item.price), 0);

    const tip = (tipableAmount * this.tipPercent) / 100;
    const tax = subtotal * this.taxRate;
    const subtotalWithTipAndTax = subtotal + tip + tax;
    const surcharge = this.ccSurcharge ? subtotalWithTipAndTax * 0.024 : 0;
    const total = subtotalWithTipAndTax + surcharge;

    document.getElementById('subtotalAmount').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('tipAmount').textContent = `$${tip.toFixed(2)}`;
    document.getElementById('taxAmount').textContent = `$${tax.toFixed(2)}`;
    document.getElementById('surchargeAmount').textContent = `$${surcharge.toFixed(2)}`;
    document.getElementById('totalAmount').textContent = `$${total.toFixed(2)}`;
  }
  async downloadAsImage() {
    try {
      const element = document.getElementById('receiptContent');
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      });
  
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `Receipt-${new Date().toISOString().split('T')[0]}.png`;
      link.href = image;
      link.click();
    } catch (error) {
      console.error('Error generating image:', error);
      alert('Could not generate receipt image. Please try printing instead.');
    }
  }
  

}

//--- File: /home/luan_ngo/web/events/public/EmailProcessor.js ---
class EmailProcessor {
    constructor(parent) {
        this.currentConversationId = null;
        this.registerEvents();
        this.parent = parent;

    }

    registerEvents() {
        
        $(document).on('click', '.summarizeEmailAI', async (e) => {
            e.preventDefault();
            const emailContent = $(e.target).closest('.sms').find('.email').text();
            await this.handleSummarizeEmail(emailContent);
        });

        
        $(document).on('click', '.draftEventSpecificEmail', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');

            const emailContent = $(e.target).closest('.sms').find('.email').text();
            const subject = $emailContainer.attr('subject') || '';
            await this.handleDraftEventEmail(emailContent, subject);
        });

        
        $(document).on('click', '.sendToAiTextArea', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');

            const emailContent = $emailContainer.find('.email').text();
            const subject = $emailContainer.attr('subject') || '';
            this.sendToAiTextArea(emailContent, subject);
        });
        $(document).on('click', '.archiveEmail', async (e) => {
            e.preventDefault();
            const $emailContainer = $(e.target).closest('.sms');
            const messageId = $emailContainer.data('id');

            const success = await this.archiveEmail(messageId);
            if (success) {
                window.app.showToast('Email archived successfully', 'success');
            } else {
                window.app.showToast('Failed to archive email', 'error');
            }
        });
        
        $(document).on('click', '#newConversation', () => {
            this.startNewConversation();
        });
    }

    startNewConversation() {
        this.currentConversationId = null;
        $('#aiText').html('');
        $('#aiResult').html('');
        $('#sendMailSubject').val(''); 

    }

    async handleSummarizeEmail(emailContent) {
        try {
            
            const cleanedText = emailContent
                .replace(/[-<>]/g, '')
                .replace(/^Sent:.*$/gm, '')
                .substring(0, 11000);

            const response = await $.post('/api/summarizeAI', {
                text: cleanedText,
                conversationId: this.currentConversationId
            });

            
            this.currentConversationId = response.conversationId;

            
            this.parent.writeToAIResult( response.summary);

        } catch (error) {
            console.error('Error summarizing email:', error);
            alert('Failed to summarize email');
        }
    }

   

    async archiveEmail(messageId) {
        try {
            const response = await $.post(`/gmail/archiveEmail/${messageId}`);
            if (response.success) {
                
                $(`.sms[data-id="${messageId}"]`).fadeOut(300, function () {
                    $(this).remove();
                });
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error archiving email:', error);
            return false;
        }
    }
    async handleDraftEventEmail(emailContent, subject) {
        try {
            const instructions = prompt('Enter any specific instructions for the email draft:');
            const combinedText = `${emailContent}\n\n[Specific Instructions: ${instructions}]`;

            const response = await $.post('/api/getAIEmail', {
                aiText: combinedText,
                emailText: emailContent,
                conversationId: this.currentConversationId,
                includeBackground: true
            });

            
            this.currentConversationId = response.conversationId;

            
            const formattedResponse = response.response ? response.response.toString().replace(/\n/g, '<br>') : '';

            
            const data = {
                content: formattedResponse,
                messageCount: response.messageCount || 0,
                isNewConversation: !this.currentConversationId
            };

            this.parent.writeToAIResult(data.content);

            
            if (subject) {
                if (subject.toLowerCase().startsWith('re:')) {
                    $('#sendMailSubject').val(subject);
                } else {
                    $('#sendMailSubject').val(`Re: ${subject}`);
                }
            }

            
            if ($('#sendMailEmail').val() === '' && response.fromEmail) {
                $('#sendMailEmail').val(response.fromEmail);
            }

            
            if (window.app.sounds && window.app.sounds.orderUp) {
                window.app.sounds.orderUp.play();
            }

        } catch (error) {
            console.error('Error drafting event email:', error);
            window.app.showToast('Failed to draft event email', 'error');
        }
    }
    sendToAiTextArea(emailContent, subject) {
        
        if (!this.currentConversationId) {
            $('#aiText').html('');
        }
        if (subject) {
            if (subject.toLowerCase().startsWith('re:')) {
                $('#sendMailSubject').val(subject);
            } else {
                $('#sendMailSubject').val(`Re: ${subject}`);
            }
        }
        
        const formattedContent = emailContent.replace(/\n/g, '<br>');
        $('#aiText').html(
            (this.currentConversationId ? $('#aiText').html() + '<br><br>--------------------<br><br>' : '') +
            formattedContent
        );

        
        $('html, body').animate({
            scrollTop: $('#aiText').offset().top
        }, 500);

        
        $('#aiText').focus();
    }
    
    updateConversationStatus(messageCount) {
        if (messageCount) {
            const statusHtml = `<div class="text-muted small mt-2">Conversation messages: ${messageCount}</div>`;
            $('.aiChatReponse').first().find('.aiChatReponseContent').after(statusHtml);
        }
    }
}

//--- File: /home/luan_ngo/web/events/public/EmailEventUpdater.js ---
class EmailEventUpdater {
    constructor(app) {
        this.app = app;
        this.highlightedFields = new Set();
    }

    async updateEventFromEmail(emailContent, emailAddress) {
        try {
            
            const event = this.app.contacts.find(contact => 
                contact.email && contact.email.toLowerCase() === emailAddress.toLowerCase()
            );

            if (!event) {
                this.app.showToast('No matching event found for this email', 'error');
                return;
            }

            
            this.app.loadContact(event.id);

            
            const response = await fetch('/ai/analyzeEventUpdate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    eventDetails: event,
                    emailContent: emailContent
                })
            });

            if (!response.ok) {
                throw new Error('Failed to analyze event update');
            }

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to analyze event update');
            }

            
            const timestamp = moment().format('MM/DD/YYYY HH:mm');
            const updatedNotes = `[${timestamp}] Update from email:\n${result.summary}\n\n${event.notes || ''}`;
            
            
            event.notes = updatedNotes;
            
            
            const updatedFields = new Set(['notes']);
            this.updateUI(event, updatedFields);

            
            

            
            

            return true;
        } catch (error) {
            console.error('Error updating event from email:', error);
            this.app.showToast('Failed to update event information', 'error');
            return false;
        }
    }

    updateUI(event, updatedFields) {
        
        this.clearHighlights();
        this.highlightedFields = updatedFields;

        
        updatedFields.forEach(field => {
            const element = document.getElementById(`info${field.charAt(0).toUpperCase() + field.slice(1)}`);
            if (element) {
                
                if (field === 'notes') {
                    element.value = event.notes;
                } else {
                    element.value = event[field];
                }

                
                const label = element.previousElementSibling;
                if (label && label.classList.contains('label')) {
                    label.style.backgroundColor = '#fff3cd';
                }
            }
        });

        
        const saveButton = document.getElementById('infoSave');
        if (saveButton) {
            const originalClick = saveButton.onclick;
            saveButton.onclick = (e) => {
                if (originalClick) originalClick(e);
                this.clearHighlights();
            };
        }
    }

    clearHighlights() {
        this.highlightedFields.forEach(field => {
            const element = document.getElementById(`info${field.charAt(0).toUpperCase() + field.slice(1)}`);
            if (element) {
                const label = element.previousElementSibling;
                if (label && label.classList.contains('label')) {
                    label.style.backgroundColor = '';
                }
            }
        });
        this.highlightedFields.clear();
    }
}

//--- File: /home/luan_ngo/web/events/src/styles.css ---
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {

  html,
  body {
    @apply overflow-x-hidden;
  }

  body {
    @apply pb-16 lg:pb-0;
    @apply bg-base-100;
  }
}

@layer components {

  
  .card {
    @apply bg-base-200 text-base-content border border-base-300;
  }

  
  .form-control {
    @apply relative space-y-1;
  }

  .form-control .label {
    @apply pb-1;
  }

  .form-control .label-text {
    @apply opacity-70 font-medium;
  }

  .input,
  .select,
  .textarea {
    @apply bg-base-100 border-base-300 transition-all duration-200;
    @apply focus:ring-2 focus:ring-primary/20 focus:border-primary;
    @apply disabled:bg-base-200 disabled:cursor-not-allowed;
  }

  
  .messages-container {
    @apply flex-1 overflow-y-auto overflow-x-hidden space-y-4 p-4;
    height: calc(100vh - 16rem);
    
    -webkit-overflow-scrolling: touch;
  }

  
  .top-nav {
    @apply hidden lg:flex fixed top-4 right-4 gap-2 z-50;
  }

  .btm-nav {
    @apply fixed bottom-0 left-0 right-0 z-[9999] bg-base-100 border-t border-base-200;
    @apply flex flex-row justify-around items-center;
    @apply lg:hidden;
    
    height: 4rem;
    position: fixed !important;
    
  }

  .btm-nav button {
    @apply flex-1 flex flex-col items-center justify-center gap-1;
    @apply transition-colors duration-200;
    @apply text-base-content/70 hover:text-base-content;
    min-height: 4rem;
  }

  .btm-nav button.active {
    @apply text-primary bg-base-200 border-t-2 border-primary;
  }

  
  body {
    @apply pb-16 lg:pb-0;
    
  }

  main {
    @apply mb-16 lg:mb-0;
    
  }

  
  #messages,
  #actions {
    @apply flex flex-col;
    min-height: calc(100vh - 16rem);
    @apply lg:h-[75vh];
  }

  @screen lg {
    .messages-container {
      height: calc(75vh - 8rem);
      
    }
  }

  
  #calendarContainer {
    @apply w-full overflow-x-auto pb-4 -mx-4 px-4;
    @apply lg:mx-0 lg:px-0;
  }

  .calendar {
    @apply min-w-[800px] w-full border-collapse;
  }

  .calendar th {
    @apply p-2 text-center border border-base-300 bg-base-300;
  }

  .calendar td {
    @apply p-2 border border-base-300 align-top bg-base-100;
    @apply transition-colors hover:bg-base-300/30;
  }

  
  .sms {
    @apply bg-base-100 border border-base-300 rounded-lg p-4;
  }

  .email {
    @apply transition-all duration-200 overflow-hidden;
    max-height: 25vh;
  }

  .email.expanded {
    max-height: none;
  }

  .email-header {
    @apply mb-3 text-sm text-base-content/70 space-y-1;
  }

  .email-body {
    @apply text-base-content whitespace-pre-line mt-4;
  }

  
  .icon-btn {
    @apply inline-flex items-center justify-center w-8 h-8 rounded-full;
    @apply hover:bg-base-200 transition-colors text-base-content/70 hover:text-base-content;
  }

  
  .aiChatReponse {
    @apply bg-base-200 border border-base-300 rounded-lg p-4;
  }

  
  .contactCont {
    @apply p-2 hover:bg-base-300/50 rounded-lg transition-colors;
  }

  
  .event-bar {
    @apply text-xs p-1 mt-1 rounded cursor-pointer truncate;
  }

  .event-room-1 {
    @apply bg-primary/30 hover:bg-primary/40;
  }

  .event-room-2 {
    @apply bg-secondary/30 hover:bg-secondary/40;
  }

  
  @screen md {
    main {
      @apply pb-0;
    }
  }

  
  .modal {
    @apply p-4;
  }

  .modal-box {
    @apply max-h-[90vh] overflow-y-auto;
  }
}


@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideIn {
  from {
    transform: translateX(-10px);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.fade-in {
  animation: fadeIn 0.3s ease-in-out;
}

.slide-in {
  animation: slideIn 0.3s ease-in-out;
}

//--- File: /home/luan_ngo/web/events/tailwind.config.js ---

module.exports = {
  content: [
    "./src*.{html,js}",
    "./public*.{html,js}",
    "./index.html"
  ],
  theme: {
    extend: {
      
      height: {
        'screen-minus-nav': 'calc(100vh - 4rem)',
        'screen-minus-header': 'calc(100vh - 8rem)',
      },
      
      minHeight: {
        'screen-minus-nav': 'calc(100vh - 4rem)',
        'screen-minus-header': 'calc(100vh - 8rem)',
      },
      
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
      },
      
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-in-out',
        'press': 'press 0.2s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        press: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.95)' },
        },
      },
      
      screens: {
        'xs': '475px',
        
        'calendar': '900px',
      },
    },
  },
  plugins: [
    require("daisyui"),
    
    function({ addUtilities }) {
      const newUtilities = {
        '.safe-padding-bottom': {
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        },
        '.safe-margin-bottom': {
          marginBottom: 'env(safe-area-inset-bottom, 16px)',
        },
        '.mobile-height': {
          height: '-webkit-fill-available',
        },
      };
      addUtilities(newUtilities);
    },
  ],
  daisyui: {
    themes: ["light", "dark", "cupcake"],
    
    styled: true,
    base: true,
    utils: true,
    logs: true,
    rtl: false,
  },
}
