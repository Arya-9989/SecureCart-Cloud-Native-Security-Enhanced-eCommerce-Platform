from __future__ import annotations

from typing import Any

from django.contrib.auth import password_validation
from rest_framework import serializers

from apps.accounts.models import Role, User


class UserSerializer(serializers.ModelSerializer[User]):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "date_joined"]
        read_only_fields = ["id", "email", "role", "date_joined"]


class RegisterSerializer(serializers.ModelSerializer[User]):
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=128)
    full_name = serializers.CharField(max_length=150, min_length=2)

    class Meta:
        model = User
        fields = ["email", "full_name", "password"]

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        candidate = User(email=attrs["email"], full_name=attrs["full_name"])
        password_validation.validate_password(attrs["password"], user=candidate)
        return attrs

    def create(self, validated_data: dict[str, Any]) -> User:
        # Role is never accepted from the client: self-registration always yields a customer.
        return User.objects.create_user(role=Role.CUSTOMER, **validated_data)


class LoginSerializer(serializers.Serializer[None]):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, max_length=128)


class TokenResponseSerializer(serializers.Serializer[None]):
    access = serializers.CharField()
    user = UserSerializer()


class ChangePasswordSerializer(serializers.Serializer[None]):
    current_password = serializers.CharField(trim_whitespace=False, max_length=128)
    new_password = serializers.CharField(trim_whitespace=False, max_length=128)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        user: User = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": "Incorrect password."})
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": "New password must differ from the current one."}
            )
        password_validation.validate_password(attrs["new_password"], user=user)
        return attrs


class AdminUserSerializer(serializers.ModelSerializer[User]):
    order_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "role",
            "is_active",
            "date_joined",
            "last_login",
            "order_count",
        ]
        read_only_fields = ["id", "email", "full_name", "date_joined", "last_login"]

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        request_user = self.context["request"].user
        if self.instance is not None and self.instance.pk == request_user.pk:
            if attrs.get("role", self.instance.role) != Role.ADMIN:
                raise serializers.ValidationError(
                    {"role": "You cannot remove your own admin role."}
                )
            if attrs.get("is_active", True) is False:
                raise serializers.ValidationError(
                    {"is_active": "You cannot deactivate your own account."}
                )
        return attrs
