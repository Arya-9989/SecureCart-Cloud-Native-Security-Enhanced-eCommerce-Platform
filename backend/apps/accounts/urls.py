from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("register/", views.RegisterView.as_view(), name="auth-register"),
    path("login/", views.LoginView.as_view(), name="auth-login"),
    path("refresh/", views.RefreshView.as_view(), name="auth-refresh"),
    path("logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("me/", views.MeView.as_view(), name="auth-me"),
    path("password/", views.ChangePasswordView.as_view(), name="auth-password"),
    path("password/forgot/", views.ForgotPasswordView.as_view(), name="auth-password-forgot"),
    path("password/reset/", views.ResetPasswordView.as_view(), name="auth-password-reset"),
    path("email/verify/", views.VerifyEmailView.as_view(), name="auth-email-verify"),
    path("email/resend/", views.ResendVerificationView.as_view(), name="auth-email-resend"),
    path("sessions/revoke/", views.RevokeSessionsView.as_view(), name="auth-sessions-revoke"),
    path("me/export/", views.ExportDataView.as_view(), name="auth-me-export"),
    path("me/delete/", views.DeleteAccountView.as_view(), name="auth-me-delete"),
]
